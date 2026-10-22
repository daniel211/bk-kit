#!/usr/bin/env node
// native-lint-flush.cjs - Stop hook: hand the deferred native lint to a detached worker
// Trigger: Stop
// Purpose: Check whether the deferred native-lint queue has anything in it and, if so, spawn
//          lib/lint-flush-worker.cjs to drain it, group by platform and run each platform's
//          linter once over its batch. Findings go to .bk-metrics/lint-findings.jsonl and are
//          injected into the next turn by lint-findings-inject.
//
// Why this hook exists at all: the inline PostToolUse run cost 1076ms on average across 84 runs
// in one field day (fusionworkomni) — 90.4s, 97% of all PostToolUse hook time — with 4 runs
// killed by bk-dispatch at 5000/5001/5002ms and their findings lost.
//
// Why it no longer runs the linter itself: measured across 20 Stop events in the same repo,
// [4485, 2732, 2076, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0] ms. 17 of 20 Stops had
// nothing queued and cost ~1ms; the 3 with work blocked the end of the turn for 2.0–4.5 seconds,
// exactly when the user had just produced code. checkpoint-save, the next most expensive Stop
// hook, tops out at 141ms. Moving the run off the turn removes the spike without losing a
// finding — it arrives with the next prompt instead.
//
// Never blocks. Never exits 2, even with errors in the batch: a platform configured to block
// (`native_lint.<platform>.block_on_error: true`) stays inline and never reaches this hook.

'use strict';

// Outer crash wrapper (catches require/parse failures)
try {
  const { createHookTimer } = require('./lib/hook-logger.cjs');
  const { isHookEnabled } = require('./lib/bk-config-utils.cjs');
  const { resolveProjectRoot } = require('./lib/resolve-project-root.cjs');
  const { readQueuedFiles } = require('./lib/lint-queue.cjs');
  const { resolveNativeQueueFile } = require('./lib/native-lint-deferred.cjs');
  const { spawnLintWorker } = require('./lib/lint-worker-spawn.cjs');

  // Per-command bound, handed to the worker. A batched run is not under the 5s PostToolUse
  // budget — it covers every file edited in the turn and nothing is waiting on it.
  const BATCH_TIMEOUT_MS = parseInt(process.env.BK_NATIVE_LINT_TIMEOUT_MS || '60000', 10);

  async function main() {
    const timer = createHookTimer('native-lint-flush');
    try {
      if (!isHookEnabled('native-lint-flush')) {
        timer.end({ status: 'skipped', exit: 0 });
        process.exit(0);
      }

      let input = '';
      for await (const chunk of process.stdin) input += chunk;
      const data = JSON.parse(input || '{}');

      // Re-entry guard: Claude is continuing because of a Stop hook. Spawning again here is how
      // you build a loop; the worker's rename-claim would make the second spawn a no-op anyway.
      if (data.stop_hook_active === true) {
        timer.end({ status: 'skipped', reason: 'stop_hook_active', exit: 0 });
        process.exit(0);
      }

      const projectRoot = resolveProjectRoot(data);
      const sessionId = data.session_id || data.sessionId || '';

      // Read-only peek — the worker claims. stop-lint-flush ran moments ago and computed its
      // deferral from this same queue while it was still intact; claiming here in the parent
      // would have been fine for that ordering, but a spawn that failed after the claim would
      // lose the whole batch, so the claim belongs in the process that does the work.
      const queued = readQueuedFiles(resolveNativeQueueFile(projectRoot, sessionId));
      if (queued.length === 0) {
        timer.end({ status: 'ok', files: 0, exit: 0 });
        process.exit(0);
      }

      const spawned = spawnLintWorker({
        kind: 'native',
        projectRoot,
        sessionId,
        timeoutMs: BATCH_TIMEOUT_MS
      });

      timer.end({
        status: spawned ? 'ok' : 'error',
        files: queued.length,
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
      JSON.stringify({ ts: new Date().toISOString(), hook: 'native-lint-flush', status: 'crash', error: e.message }) + '\n');
  } catch (_) {}
  // Fail-open: a lint flush must never block the end of a turn
  process.exit(0);
}
