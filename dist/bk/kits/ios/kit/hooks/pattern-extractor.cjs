#!/usr/bin/env node
// pattern-extractor.cjs - Analyze recent metrics, extract patterns, inject top insights
// Trigger: Stop (main session ending)
// Purpose: Read workflow-summary.jsonl, detect patterns, write insights.md, output additionalContext
// Non-blocking (exit 0).

'use strict';

// Outer crash wrapper
try {
  const { createHookTimer } = require('./lib/hook-logger.cjs');
  const fs = require('fs');
  const path = require('path');
  const { resolveProjectRoot } = require('./lib/resolve-project-root.cjs');

  async function main() {
    const timer = createHookTimer('pattern-extractor');
    try {
      const { isHookEnabled } = require('./lib/bk-config-utils.cjs');

      if (!isHookEnabled('pattern-extractor')) {
        timer.end({ status: 'skipped', exit: 0 });
        process.exit(0);
      }

      // Consume stdin (Stop hook sends session data)
      let input = '';
      for await (const chunk of process.stdin) input += chunk;
      // Only the session id is used from a Stop event — stdin is consumed to avoid pipe errors.
      let data = {};
      try { data = JSON.parse(input || '{}') || {}; } catch { /* not JSON — ignore */ }

      const metricsDir = path.join(resolveProjectRoot(), '.bk-metrics');
      const summaryPath = path.join(metricsDir, 'workflow-summary.jsonl');

      if (!fs.existsSync(summaryPath)) {
        timer.end({ status: 'no_data', exit: 0 });
        process.exit(0);
      }

      // Window and sample-size thresholds come from the harness policy (`insights` section,
      // defaults in lib/harness-policy-loader.cjs) rather than being hardcoded here.
      let windowWorkflows = 10;
      let minWorkflows = 5;
      try {
        const cfg = require('./lib/harness-policy-loader.cjs').loadHarnessPolicy().insights || {};
        if (Number.isInteger(cfg.window_workflows) && cfg.window_workflows > 0) windowWorkflows = cfg.window_workflows;
        if (Number.isInteger(cfg.min_workflows_for_claims) && cfg.min_workflows_for_claims > 0) minWorkflows = cfg.min_workflows_for_claims;
      } catch { /* policy unreadable — keep the built-in defaults */ }

      // ALL rows are read; the window is applied to WORKFLOWS below. It used to be the last 10
      // ROWS, which in the field collapsed to 2-4 workflows (49-66 rows on disk) and produced
      // claims like "1/2 recent workflows had fix loops".
      const allLines = fs.readFileSync(summaryPath, 'utf8').split('\n').filter(Boolean);
      const allEntries = allLines
        .map(l => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean);

      if (allEntries.length === 0) {
        timer.end({ status: 'no_entries', exit: 0 });
        process.exit(0);
      }

      // ONE SUMMARY ROW IS NOT ONE WORKFLOW. A feature is legitimately closed out more than
      // once — the terminal-phase edge trigger writes a row when it first enters commit, and the
      // SessionEnd flush writes another for everything after. In the field
      // `testable-import-linkage` dispatched 8 agents and produced two correct rows, 1 and 7.
      // Every count below used to divide by rows, so insights.md's sentence "Avg N
      // agents/workflow over last N runs" was literally false: it would have said 4.0 over 2
      // runs for one workflow that ran 8 agents.
      //
      // Grouping is by the row's stamped workflow_id — `bk-code:crypto-module` for a skill
      // workflow (still merges across sessions: a resumed feature is the same workflow),
      // `session:<id>` for ad-hoc work. Grouping by (skill, feature), as 0.10.1 did, folded every
      // ad-hoc session into one "unknown/unknown" workflow: fusionworkomni's insights.md said
      // "Based on last 1 workflow(s) across 6 summary row(s) … Avg 14.0 agents/workflow" for six
      // rows from several separate sessions.
      //
      // Legacy rows (no workflow_id) carry no session to split on. One with a known feature gets
      // the key the writer would stamp today, so a skill workflow straddling the upgrade stays
      // one workflow; one with feature "unknown" keeps the 0.10.1 (skill, feature) grouping in
      // its own key space — pre-stamp ad-hoc rows in the window still collapse together, an
      // honest limit that ages out of the window.
      //
      // All within the window read above — the same feature reopened weeks later is genuinely a
      // second workflow, and the window is the bound on that. No time-gap heuristic is applied;
      // inventing one would put a guess where there is an honest limit. Kept in sync by hand with
      // workflowKey / groupIntoWorkflows in cli/user-cli/commands/cmd-metrics.mjs, which is ESM
      // and cannot be required from here.
      const workflowKey = (e) => {
        if (typeof e.workflow_id === 'string' && e.workflow_id.trim()) return e.workflow_id.trim();
        const sk = e.skill && e.skill !== 'unknown' ? e.skill : '';
        const ft = e.feature && e.feature !== 'unknown' ? e.feature : '';
        if (ft) return `${sk || 'session'}:${ft}`;
        return `legacy\u0000${e.skill || 'unknown'}\u0000${e.feature || 'unknown'}`;
      };
      // Rows of one workflow are SUMMED, not "latest wins": each row covers only the agents
      // traced since the previous close-out (1 then 7 agents for one 8-agent workflow), so
      // keeping only the latest row would drop most of the workflow.
      const workflowMap = new Map();
      for (const e of allEntries) {
        const key = workflowKey(e);
        if (!workflowMap.has(key)) {
          workflowMap.set(key, {
            skill: e.skill || 'unknown', total_agents: 0, fix_loops: 0, reactive_signals: 0, rows: 0
          });
        }
        const wf = workflowMap.get(key);
        wf.rows++;
        // Re-insert so Map order tracks each workflow's MOST RECENT row.
        workflowMap.delete(key); workflowMap.set(key, wf);
        wf.total_agents += e.total_agents || 0;
        wf.fix_loops += e.fix_loops || 0;
        wf.reactive_signals += e.reactive_signals || 0;
      }
      // The last N workflows by most recent activity.
      const workflows = Array.from(workflowMap.values()).slice(-windowWorkflows);
      const entries = { length: workflows.reduce((n, w) => n + w.rows, 0) };
      const enoughData = workflows.length >= minWorkflows;
      const insufficient = `n=${workflows.length}, need >=${minWorkflows}`;

      const insights = [];
      // Notes are shown in insights.md only; they are not injected into the session context.
      const notes = [];

      // Pattern 1: High fix-loop rate
      const withFixLoops = workflows.filter(w => w.fix_loops > 0);
      if (enoughData && withFixLoops.length / workflows.length > 0.3) {
        insights.push(`Plan quality may need improvement — ${withFixLoops.length}/${workflows.length} recent workflows had fix loops.`);
      }

      // Pattern 2: Frequent agent_stuck / reactive signals
      const highReactive = workflows.filter(w => w.reactive_signals > 1);
      if (highReactive.length >= 2) {
        insights.push(`Consider dispatching bk-brainstormer earlier in pipeline — ${highReactive.length} workflows triggered multiple reactive signals.`);
      }

      // Pattern 3: Specific agent failure patterns — high fix_loops on specific skills
      const skillFixMap = {};
      for (const w of workflows) {
        const sk = w.skill || 'unknown';
        if (!skillFixMap[sk]) skillFixMap[sk] = { runs: 0, fixLoops: 0 };
        skillFixMap[sk].runs++;
        skillFixMap[sk].fixLoops += w.fix_loops;
      }
      let skillsTooFew = 0;
      for (const [sk, stats] of Object.entries(skillFixMap)) {
        // An average over fewer than minWorkflows runs of this skill is anecdote, not a pattern.
        if (stats.runs < minWorkflows) { if (stats.runs >= 2 && stats.fixLoops / stats.runs >= 1.5) skillsTooFew++; continue; }
        if (stats.fixLoops / stats.runs >= 1.5) {
          insights.push(`Check prompt for ${sk} — avg ${(stats.fixLoops / stats.runs).toFixed(1)} fix loops per run across ${stats.runs} runs.`);
        }
      }

      if (!enoughData) {
        notes.push(`Fix-loop rate and per-skill averages: insufficient data (${insufficient}).`);
      } else if (skillsTooFew > 0) {
        notes.push(`Per-skill fix-loop average: insufficient data for ${skillsTooFew} skill(s) with fewer than ${minWorkflows} runs.`);
      }

      // Default insight if no patterns detected
      if (insights.length === 0) {
        const avgAgents = workflows.reduce((s, w) => s + w.total_agents, 0) / workflows.length;
        // Below the sample floor this is a plain count, with no "looks good" verdict attached.
        insights.push(enoughData
          ? `Workflow health looks good. Avg ${avgAgents.toFixed(1)} agents/workflow over last ${workflows.length} runs.`
          : `Avg ${avgAgents.toFixed(1)} agents/workflow over last ${workflows.length} runs — insufficient data for a health verdict (${insufficient}).`);
      }

      // Test gaps: unique source files still without a test (see lib/test-gap-ledger.cjs).
      // Rows whose file has since been deleted are ignored. Section only when > 0.
      let testGapLines = [];
      try {
        const root = resolveProjectRoot();
        const gaps = require('./lib/test-gap-ledger.cjs')
          .readUniqueTestGaps(path.join(metricsDir, 'test-gaps.jsonl'))
          .filter(g => fs.existsSync(path.isAbsolute(g.file) ? g.file : path.join(root, g.file)));
        if (gaps.length > 0) {
          testGapLines = [
            '',
            '## Test gaps',
            `- ${gaps.length} unique file(s) without a test. Most-edited:`,
            ...gaps.slice(0, 5).map(g => `  - ${g.file} (${g.count} edit${g.count === 1 ? '' : 's'})`)
          ];
          insights.push(`${gaps.length} source file(s) have no test — see "Test gaps" in insights.md.`);
        }
      } catch { /* optional section */ }

      // Cost by model: per model / per agent spend from the subagent rows of cost-ledger.jsonl,
      // with each model's fix-loop rate over ALL summarised workflows it ran in (not just the
      // window — spend is lifetime, so the join is too). See lib/cost-by-model.cjs. Section only
      // when the ledger has subagent rows.
      let costLines = [];
      try {
        const cbm = require('./lib/cost-by-model.cjs');
        const rows = cbm.readSubagentLedgerRows(path.join(metricsDir, 'cost-ledger.jsonl'));
        costLines = cbm.renderCostByModel(cbm.summarizeCostByModel(rows, workflowMap), { minWorkflows });
      } catch { /* optional section */ }

      // Write insights.md (overwrite with latest)
      fs.mkdirSync(metricsDir, { recursive: true });
      const insightsPath = path.join(metricsDir, 'insights.md');
      const insightsContent = [
        `# Beer Kit Workflow Insights`,
        `_Generated: ${new Date().toISOString()}_`,
        `_Based on last ${workflows.length} workflow(s) across ${entries.length} summary row(s)_`,
        '',
        '## Detected Patterns',
        '',
        ...insights.map((ins, i) => `${i + 1}. ${ins}`),
        ...notes.map(n => `- ${n}`),
        '',
        '## Raw Stats',
        `- Total workflows analyzed: ${workflows.length}`,
        `- Summary rows read: ${entries.length}`,
        `- Workflows with fix loops: ${withFixLoops.length}`,
        `- Total reactive signals: ${workflows.reduce((s, w) => s + w.reactive_signals, 0)}`,
        ...testGapLines,
        ...costLines
      ].join('\n');
      fs.writeFileSync(insightsPath, insightsContent, 'utf8');

      // Output top 3 insights as additionalContext
      const top3 = insights.slice(0, 3);
      const contextLines = [
        '[PATTERN-INSIGHTS]',
        ...top3.map((ins, i) => `${i + 1}. ${ins}`)
      ];

      // Advisory context is subject to the shared injection budget (cap + dedupe). Optional:
      // if the lib is absent the text goes out unchanged.
      let text = contextLines.join('\n');
      try {
        const injectionBudget = require('./lib/injection-budget.cjs');
        text = injectionBudget.prepareInjection('pattern-extractor', text, {
          sessionId: injectionBudget.sessionIdFrom(data)
        });
      } catch { /* optional lib — keep the full text */ }

      if (text) process.stdout.write(JSON.stringify({ additionalContext: text }) + '\n');

      timer.end({ status: 'ok', insights: insights.length, exit: 0 });
      process.exit(0);
    } catch (err) {
      timer.end({ status: 'error', error: err.message, exit: 0 });
      process.exit(0);
    }
  }
  main();
} catch (e) {
  // A DispatchExit is this hook's own process.exit() unwinding under bk-dispatch, not a
  // crash. Logging it here is how a clean run got filed as `status: "crash"`.
  if (e && e.bkDispatchExit) throw e;

  try {
    const fs = require('fs');
    const p = require('path');
    const logDir = p.join(__dirname, '.logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    try { const {appendJsonl: _ra} = require('./lib/jsonl-rotator.cjs'); _ra(p.join(logDir, 'hook-log.jsonl'), JSON.stringify({ ts: new Date().toISOString(), hook: 'pattern-extractor', status: 'crash', error: e.message }) + '\n'); }
    catch(_e2) { fs.appendFileSync(p.join(logDir, 'hook-log.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), hook: 'pattern-extractor', status: 'crash', error: e.message }) + '\n'); }
  } catch (_) {}
  process.exit(0); // Fail-open
}
