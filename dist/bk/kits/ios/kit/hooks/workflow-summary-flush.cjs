#!/usr/bin/env node
// workflow-summary-flush.cjs - Stop hook: close out the current workflow's unsummarized agents
// Trigger: Stop
// Purpose: Emit one rollup summary for the current (skill, feature) at the end of a session.
//
// workflow-metrics.cjs summarizes on the EDGE into a terminal phase, and post-commit.cjs pins
// current_phase at "commit" with nothing moving it back — so a feature gets at most one summary
// and everything after its first commit (reviews, follow-up fixes: the majority of the work)
// went unrecorded. A feature change closes the previous feature, but nothing follows the LAST
// feature of a session. Field cases this hook is the only close-out for: the trailing feature
// of every trustcall_ios session, and the whole fusionworkomni ad-hoc run (skill and feature
// both "unknown", 10 agents traced, summary said 4) which no feature change ever followed.
//
// Never blocks, never exits non-zero, never throws out of the outer wrapper.

'use strict';

// Outer crash wrapper (catches require/parse failures)
try {
  const fs = require('fs');
  const path = require('path');
  const { createHookTimer } = require('./lib/hook-logger.cjs');
  const { isHookEnabled, readWorkflowState } = require('./lib/bk-config-utils.cjs');
  const { resolveProjectRoot } = require('./lib/resolve-project-root.cjs');
  const { emitSummary } = require('./lib/workflow-summary.cjs');

  async function main() {
    const timer = createHookTimer('workflow-summary-flush');
    try {
      if (!isHookEnabled('workflow-summary-flush')) {
        timer.end({ status: 'skipped', exit: 0 });
        process.exit(0);
      }

      let input = '';
      for await (const chunk of process.stdin) input += chunk;
      const data = JSON.parse(input || '{}');

      // Re-entry guard: Claude is continuing because of a Stop hook. The first pass already
      // flushed; a second rollup here would be the empty one emitSummary refuses anyway, but
      // re-entering a Stop hook at all is how you build a loop.
      if (data.stop_hook_active === true) {
        timer.end({ status: 'skipped', reason: 'stop_hook_active', exit: 0 });
        process.exit(0);
      }

      const metricsDir = path.join(resolveProjectRoot(data), '.bk-metrics');
      // No metrics directory means no trace rows, so nothing can be owed a summary. Do not
      // create it — an empty .bk-metrics/ in a project that never ran an agent is litter.
      if (!fs.existsSync(path.join(metricsDir, 'agent-trace.jsonl'))) {
        timer.end({ status: 'ok', summarized: 0, exit: 0 });
        process.exit(0);
      }

      const state = readWorkflowState() || {};
      const summary = emitSummary({
        metricsDir,
        skill: state.command || 'unknown',
        feature: state.feature || 'unknown',
        phase: state.current_phase || '',
        complexityTier: state.complexity_tier || 'Standard',
        closedBy: 'session-stop'
      });

      // null means every row for this key was already covered by an earlier close-out. A
      // rollup reading total_agents 0 is noise — this is the common case for a session that
      // ended cleanly on a commit.
      timer.end({
        status: 'ok',
        summarized: summary ? summary.total_agents : 0,
        exit: 0
      });
      process.exit(0);
    } catch (err) {
      // Under bk-dispatch the happy-path process.exit(0) arrives here as a DispatchExit.
      // Re-throw it — the dispatch runner owns it.
      if (err && err.bkDispatchExit) throw err;
      timer.end({ status: 'error', error: err.message, exit: 0 });
      process.exit(0);
    }
  }
  main();
} catch (e) {
  // A DispatchExit is this hook's own process.exit() unwinding under bk-dispatch, not a crash.
  if (e && e.bkDispatchExit) throw e;

  try {
    const fs = require('fs');
    const p = require('path');
    const logDir = p.join(__dirname, '.logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(p.join(logDir, 'hook-log.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), hook: 'workflow-summary-flush', status: 'crash', error: e.message }) + '\n');
  } catch (_) {}
  process.exit(0); // Fail-open: a metrics hook must never block the end of a turn
}
