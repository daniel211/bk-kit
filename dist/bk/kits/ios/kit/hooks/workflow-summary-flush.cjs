#!/usr/bin/env node
// workflow-summary-flush.cjs - SessionEnd hook: close out the session's unsummarized agents
// Trigger: SessionEnd
// Purpose: Emit one rollup summary for the current (skill, feature) when the session ends.
//
// WHY SessionEnd AND NOT Stop. workflow-metrics.cjs summarizes on the EDGE into a terminal
// phase, and post-commit.cjs pins current_phase at "commit" with nothing moving it back — so a
// feature gets at most one summary and everything after its first commit (reviews, follow-up
// fixes: the majority of the work) went unrecorded. A feature change closes the feature before
// it, but nothing follows the LAST feature of a session, and nothing follows an ad-hoc run at
// all (fusionworkomni: skill and feature both "unknown", 10 agents traced, summary said 4).
//
// This hook shipped on `Stop` first, and that was wrong. Stop fires at the end of every TURN,
// and a turn usually contains exactly one finished agent — so the rollup ran per turn. In
// trustcall_ios on 0.10.0 the feature `testable-import-linkage` dispatched 8 agents and produced
// 9 summaries, every one reading total_agents 1, 8 of them closed_by "session-stop";
// fusionworkomni showed 5 summaries for 4 agents. `bk metrics` then reported avg_agents 1.0.
// That is precisely the shape the terminal-phase edge trigger exists to prevent — the comment in
// workflow-metrics.cjs describes the original as "30 summary rows in one day, each reading
// total_agents 1". The mechanism was right and only the trigger was wrong: the first flush in
// each repo correctly swept the pre-update backlog (fusionworkomni's first post-update summary
// reads 6 agents).
//
// SessionEnd fires once, at the end of the session, which is the semantics this hook is named
// for. Its payload carries cwd, hook_event_name, prompt_id, reason, scratchpad_dir, session_id
// and transcript_path — and notably NO stop_hook_active, so there is no re-entry guard here. A
// guard reading a field that is always undefined is the same class of bug as the `data.status`
// read that made every trace row "unknown".
//
// KNOWN LIMIT: SessionEnd does not fire if a session is killed hard, and an interactive session
// that stays open will not flush until /clear or exit. The tail is unsummarized until then —
// which is exactly the pre-0.10.0 behaviour, so this is no worse, just not perfect.
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

      // A hook must not trust that it was invoked on the right event.
      //
      // Nothing in this file used to look at hook_event_name, so the ONLY thing separating a
      // correct run from the per-turn over-counting above was one line in settings.json. Fed a
      // Stop payload by accident while probing, it flushed happily and produced 8 summaries —
      // and a downstream project that hand-merged settings.json wrong would reintroduce the
      // whole regression silently. The event is named on the payload, so check it.
      //
      // Fail-open, as everywhere else: a missing or unrecognised hook_event_name is treated as
      // the wrong event and no-ops, rather than throwing. The distinct status is the point —
      // a misregistration then shows up in hook-log.jsonl naming the event it actually got,
      // instead of quietly corrupting workflow-summary.jsonl.
      const eventName = typeof data.hook_event_name === 'string' ? data.hook_event_name : '';
      if (eventName !== 'SessionEnd') {
        timer.end({ status: 'wrong_event', tool: eventName || 'none', exit: 0 });
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
        reason: data.reason || '',
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
  process.exit(0); // Fail-open: a metrics hook must never block the end of a session
}
