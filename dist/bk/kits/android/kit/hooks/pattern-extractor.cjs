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

      // Read last 10 entries
      const allLines = fs.readFileSync(summaryPath, 'utf8').split('\n').filter(Boolean);
      const entries = allLines
        .slice(-10)
        .map(l => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean);

      if (entries.length === 0) {
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
      // Grouping is by (skill, feature) within the window read above — the same feature reopened
      // weeks later is genuinely a second workflow, and the window is the bound on that. No
      // time-gap heuristic is applied; inventing one would put a guess where there is an honest
      // limit. Kept in sync by hand with groupIntoWorkflows in cli/user-cli/commands/
      // cmd-metrics.mjs, which is ESM and cannot be required from here.
      const workflowMap = new Map();
      for (const e of entries) {
        const key = `${e.skill || 'unknown'}\u0000${e.feature || 'unknown'}`;
        if (!workflowMap.has(key)) {
          workflowMap.set(key, {
            skill: e.skill || 'unknown', total_agents: 0, fix_loops: 0, reactive_signals: 0
          });
        }
        const wf = workflowMap.get(key);
        wf.total_agents += e.total_agents || 0;
        wf.fix_loops += e.fix_loops || 0;
        wf.reactive_signals += e.reactive_signals || 0;
      }
      const workflows = Array.from(workflowMap.values());

      const insights = [];

      // Pattern 1: High fix-loop rate
      const withFixLoops = workflows.filter(w => w.fix_loops > 0);
      if (workflows.length > 0 && withFixLoops.length / workflows.length > 0.3) {
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
      for (const [sk, stats] of Object.entries(skillFixMap)) {
        if (stats.runs >= 2 && stats.fixLoops / stats.runs >= 1.5) {
          insights.push(`Check prompt for ${sk} — avg ${(stats.fixLoops / stats.runs).toFixed(1)} fix loops per run across ${stats.runs} runs.`);
        }
      }

      // Default insight if no patterns detected
      if (insights.length === 0) {
        const avgAgents = workflows.reduce((s, w) => s + w.total_agents, 0) / workflows.length;
        insights.push(`Workflow health looks good. Avg ${avgAgents.toFixed(1)} agents/workflow over last ${workflows.length} runs.`);
      }

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
        '',
        '## Raw Stats',
        `- Total workflows analyzed: ${workflows.length}`,
        `- Summary rows read: ${entries.length}`,
        `- Workflows with fix loops: ${withFixLoops.length}`,
        `- Total reactive signals: ${workflows.reduce((s, w) => s + w.reactive_signals, 0)}`
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
