#!/usr/bin/env node
// stop-lint-flush.cjs - Stop hook: hand this turn's lint batch to a detached worker
// Template variables: ios, swiftlint lint --strict
// Trigger: Stop
// Purpose: Decide whether there is anything to lint, work out which paths native-lint is about
//          to cover anyway, and spawn lib/lint-flush-worker.cjs to do the actual run. Findings
//          are written to .bk-metrics/lint-findings.jsonl and injected into the next turn by
//          lint-findings-inject.
//
// The linter no longer runs inline. Measured across 20 Stop events in fusionworkomni:
// [4485, 2732, 2076, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0] ms — 17 Stops had
// nothing queued and cost ~1ms, while the 3 that had work held the end of the turn for 2.0–4.5
// seconds, exactly when the user had just produced code. The next most expensive Stop hook,
// checkpoint-save, tops out at 141ms. Lint findings do not have to land inside the turn that
// produced the code, so they no longer do.
//
// Never blocks, never exits non-zero, never throws out of the outer wrapper.

'use strict';

// Outer crash wrapper (catches require/parse failures)
try {
  const { createHookTimer } = require('./lib/hook-logger.cjs');
  const { isHookEnabled, loadConfig } = require('./lib/bk-config-utils.cjs');
  const { resolveProjectRoot } = require('./lib/resolve-project-root.cjs');
  const { resolveQueueFile, readQueuedFiles } = require('./lib/lint-queue.cjs');
  const { spawnLintWorker, computeDeferredPaths } = require('./lib/lint-worker-spawn.cjs');

  // Template-injected values
  const PLATFORM = 'ios';
  const LINT_COMMAND = 'swiftlint lint --strict';

  // Per-command bound, handed to the worker. Unchanged: larger than the old per-file 30s
  // because one command covers every file edited in the turn.
  const BATCH_TIMEOUT_MS = parseInt(process.env.BK_LINT_TIMEOUT_MS || '60000', 10);

  async function main() {
    const timer = createHookTimer('stop-lint-flush');
    try {
      if (!isHookEnabled('stop-lint-flush')) {
        timer.end({ status: 'skipped', exit: 0 });
        process.exit(0);
      }

      let input = '';
      for await (const chunk of process.stdin) input += chunk;
      const data = JSON.parse(input || '{}');

      // Re-entry guard: Claude is continuing because of a Stop hook. Spawning again here is how
      // you build a loop. The worker's rename-claim would make the second spawn a no-op anyway.
      if (data.stop_hook_active === true) {
        timer.end({ status: 'skipped', reason: 'stop_hook_active', exit: 0 });
        process.exit(0);
      }

      const platform = PLATFORM || 'unknown';
      const projectRoot = resolveProjectRoot(data);
      const sessionId = data.session_id || data.sessionId || '';

      // Read-only peek. The worker does the claiming — see lint-flush-worker's header: a spawn
      // that failed after a parent-side claim would lose the whole batch.
      const queued = readQueuedFiles(resolveQueueFile(projectRoot, sessionId));
      if (queued.length === 0) {
        timer.end({ status: 'ok', files: 0, exit: 0 });
        process.exit(0);
      }

      // Which of those files native-lint-flush is about to analyze with the same tool. Computed
      // here, in the parent, and passed down: both workers are detached, so a peek from inside
      // the batch worker could race the native worker's claim and resurrect the double
      // `dart analyze` per turn this deferral exists to prevent. Read-only on the native queue.
      const deferredPaths = computeDeferredPaths({
        projectRoot, sessionId, platform,
        lintCommand: LINT_COMMAND,
        nativeEnabled: isHookEnabled('native-lint-flush')
      });

      if (deferredPaths.length > 0) {
        const deferred = new Set(deferredPaths.map(String));
        if (queued.every((f) => deferred.has(f))) {
          // Everything is covered by the native run. Distinct status so the dispatch report
          // shows a deferral, not a turn with nothing to lint.
          timer.end({ status: 'deferred_to_native', files: 0, deferred: queued.length, exit: 0 });
          process.exit(0);
        }
      }

      const cfg = loadConfig() || {};
      const spawned = spawnLintWorker({
        kind: 'batch',
        projectRoot,
        sessionId,
        platform,
        lintCommand: LINT_COMMAND,
        mode: (cfg.lint && cfg.lint.batch) === 'per-file' ? 'per-file' : 'auto',
        deferredPaths,
        timeoutMs: BATCH_TIMEOUT_MS
      });

      timer.end({
        status: spawned ? 'ok' : 'error',
        files: queued.length,
        deferred: deferredPaths.length,
        error: spawned ? '' : 'spawn_failed',
        exit: 0
      });
      process.exit(0);
    } catch (err) {
      // Under bk-dispatch the happy-path process.exit(0) arrives here as a DispatchExit.
      if (err && err.bkDispatchExit) throw err;
      timer.end({ status: 'error', error: err.message, exit: 0 });
      process.exit(0);
    }
  }
  main();
} catch (e) {
  if (e && e.bkDispatchExit) throw e;
  try {
    const fs = require('fs');
    const p = require('path');
    const logDir = p.join(__dirname, '.logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(p.join(logDir, 'hook-log.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), hook: 'stop-lint-flush', status: 'crash', error: e.message }) + '\n');
  } catch (_) {}
  // Fail-open: lint hook must never block the end of a turn
  process.exit(0);
}
