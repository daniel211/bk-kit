#!/usr/bin/env node
// lint-findings-inject.cjs - UserPromptSubmit hook: deliver lint findings, and drain what an
//                            interrupted turn left behind
// Template variables: web, npx eslint .
// Trigger: UserPromptSubmit
// Purpose: Two jobs, both tied to this event on purpose.
//
//   1. DRAIN. The lint flush is Stop-gated, and Stop does not fire on an interrupted turn.
//      Measured in fusionworkomni: last Stop 02:31:44, then a 10-minute turn that ended with a
//      UserPromptSubmit at 02:41:46 and no Stop in between. 7 .dart files were queued in that
//      window and never linted — lint-queue's 24h reaper then DELETED the queue rather than
//      draining it. This is the same event the field evidence shows that turn ending on, so a
//      queue that survived Stop is drained here. On a normal turn the queue was already claimed
//      at Stop, so this is two existsSync calls, about 1ms.
//
//   2. INJECT. The linter now runs in a detached worker (see lib/lint-flush-worker.cjs), so its
//      findings outlive the turn that produced them. They are injected here as context, once —
//      lint-findings-store claims the file by rename, so nothing is re-injected on the next
//      prompt.
//
// Never blocks. Always exits 0.

'use strict';

// Outer crash wrapper (catches require/parse failures)
try {
  const { createHookTimer } = require('./lib/hook-logger.cjs');
  const { isHookEnabled } = require('./lib/bk-config-utils.cjs');
  const { resolveProjectRoot } = require('./lib/resolve-project-root.cjs');
  const { takeFindings } = require('./lib/lint-findings-store.cjs');
  const {
    spawnLintWorker, computeDeferredPaths, hasQueuedWork
  } = require('./lib/lint-worker-spawn.cjs');

  // Template-injected values
  const PLATFORM = 'web';
  const LINT_COMMAND = 'npx eslint .';

  const BATCH_TIMEOUT_MS = parseInt(process.env.BK_LINT_TIMEOUT_MS || '60000', 10);

  // Findings are advisory context, so they are subject to the shared injection budget (cap +
  // dedupe), exactly like agent-signal-detector's advice. Optional: if the lib is absent the
  // text goes out unchanged.
  let injectionBudget = null;
  try { injectionBudget = require('./lib/injection-budget.cjs'); } catch { /* optional */ }

  async function main() {
    const timer = createHookTimer('lint-findings-inject');
    try {
      if (!isHookEnabled('lint-findings-inject')) {
        timer.end({ status: 'skipped', exit: 0 });
        process.exit(0);
      }

      let input = '';
      for await (const chunk of process.stdin) input += chunk;
      const data = JSON.parse(input || '{}');

      const platform = PLATFORM || 'unknown';
      const projectRoot = resolveProjectRoot(data);
      const sessionId = data.session_id || data.sessionId || '';

      // ── 1. Drain whatever Stop never got to ────────────────────────────────
      const pending = hasQueuedWork(projectRoot, sessionId);
      let spawned = 0;

      if (pending.native && isHookEnabled('native-lint-flush')) {
        if (spawnLintWorker({
          kind: 'native', projectRoot, sessionId, timeoutMs: BATCH_TIMEOUT_MS
        })) spawned += 1;
      }

      if (pending.batch && isHookEnabled('stop-lint-flush')) {
        // Same deferral the Stop hook applies, computed in this parent for the same reason: the
        // workers are detached, so peeking at the native queue from inside one could race the
        // other's claim and lint a flutter file twice.
        const deferredPaths = computeDeferredPaths({
          projectRoot, sessionId, platform,
          lintCommand: LINT_COMMAND,
          nativeEnabled: isHookEnabled('native-lint-flush')
        });
        if (spawnLintWorker({
          kind: 'batch',
          projectRoot,
          sessionId,
          platform,
          lintCommand: LINT_COMMAND,
          deferredPaths,
          timeoutMs: BATCH_TIMEOUT_MS
        })) spawned += 1;
      }

      // ── 2. Inject whatever a worker has already finished ──────────────────
      // Deliberately NOT waiting on the spawns above: a worker that starts now reports into the
      // turn after this one. Blocking here to collect it would put the 2–4.5s spike back, just
      // at the start of a turn instead of the end.
      const records = takeFindings(projectRoot);
      if (records.length === 0) {
        timer.end({ status: 'ok', spawned, findings: 0, exit: 0 });
        process.exit(0);
      }

      const body = records.map((r) => String(r.text || '').trimEnd()).filter(Boolean).join('\n');
      const text = injectionBudget
        ? injectionBudget.prepareInjection('lint-findings-inject', body, {
            sessionId: injectionBudget.sessionIdFrom(data)
          })
        : body;

      if (text) process.stdout.write(text + '\n');

      timer.end({
        status: 'ok', spawned, findings: records.length, injected: !!text, exit: 0
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
      JSON.stringify({ ts: new Date().toISOString(), hook: 'lint-findings-inject', status: 'crash', error: e.message }) + '\n');
  } catch (_) {}
  process.exit(0); // Fail-open: never block a user prompt
}
