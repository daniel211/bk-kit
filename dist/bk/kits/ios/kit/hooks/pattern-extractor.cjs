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

      const insights = [];

      // Pattern 1: High fix-loop rate
      const withFixLoops = entries.filter(e => (e.fix_loops || 0) > 0);
      if (entries.length > 0 && withFixLoops.length / entries.length > 0.3) {
        insights.push(`Plan quality may need improvement — ${withFixLoops.length}/${entries.length} recent workflows had fix loops.`);
      }

      // Pattern 2: Frequent agent_stuck / reactive signals
      const highReactive = entries.filter(e => (e.reactive_signals || 0) > 1);
      if (highReactive.length >= 2) {
        insights.push(`Consider dispatching bk-brainstormer earlier in pipeline — ${highReactive.length} workflows triggered multiple reactive signals.`);
      }

      // Pattern 3: Specific agent failure patterns — high fix_loops on specific skills
      const skillFixMap = {};
      for (const e of entries) {
        const sk = e.skill || 'unknown';
        if (!skillFixMap[sk]) skillFixMap[sk] = { runs: 0, fixLoops: 0 };
        skillFixMap[sk].runs++;
        skillFixMap[sk].fixLoops += e.fix_loops || 0;
      }
      for (const [sk, stats] of Object.entries(skillFixMap)) {
        if (stats.runs >= 2 && stats.fixLoops / stats.runs >= 1.5) {
          insights.push(`Check prompt for ${sk} — avg ${(stats.fixLoops / stats.runs).toFixed(1)} fix loops per run across ${stats.runs} runs.`);
        }
      }

      // Default insight if no patterns detected
      if (insights.length === 0) {
        const avgAgents = entries.reduce((s, e) => s + (e.total_agents || 0), 0) / entries.length;
        insights.push(`Workflow health looks good. Avg ${avgAgents.toFixed(1)} agents/workflow over last ${entries.length} runs.`);
      }

      // Write insights.md (overwrite with latest)
      fs.mkdirSync(metricsDir, { recursive: true });
      const insightsPath = path.join(metricsDir, 'insights.md');
      const insightsContent = [
        `# MK Workflow Insights`,
        `_Generated: ${new Date().toISOString()}_`,
        `_Based on last ${entries.length} workflow(s)_`,
        '',
        '## Detected Patterns',
        '',
        ...insights.map((ins, i) => `${i + 1}. ${ins}`),
        '',
        '## Raw Stats',
        `- Total workflows analyzed: ${entries.length}`,
        `- Workflows with fix loops: ${withFixLoops.length}`,
        `- Total reactive signals: ${entries.reduce((s, e) => s + (e.reactive_signals || 0), 0)}`
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
