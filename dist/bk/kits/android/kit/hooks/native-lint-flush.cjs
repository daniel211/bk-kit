#!/usr/bin/env node
// native-lint-flush.cjs - Stop hook: run the deferred native lint ONCE per turn
// Trigger: Stop
// Purpose: Drain the deferred native-lint queue written by arch-fitness-<platform>-native.cjs,
//          group the paths by platform, and run each platform's linter a single time over the
//          whole batch — emitting the same per-file findings and red/yellow signals the inline
//          path used to emit.
//
// Why this hook exists: the inline run cost 1076ms on average across 84 PostToolUse runs in one
// field day (fusionworkomni) — 90.4s, 97% of all PostToolUse hook time — and 4 of those runs were
// killed by bk-dispatch at exactly 5000/5001/5002ms with their findings lost, because the hook
// had handed `dart analyze` a 30000ms budget the dispatcher never honoured.
//
// Never blocks. Never exits 2, even with errors in the batch: a platform configured to block
// (`native_lint.<platform>.block_on_error: true`) stays inline and never reaches this hook.

'use strict';

// Outer crash wrapper (catches require/parse failures)
try {
  const { createHookTimer } = require('./lib/hook-logger.cjs');
  const path = require('path');
  const { isHookEnabled } = require('./lib/bk-config-utils.cjs');
  const { resolveProjectRoot } = require('./lib/resolve-project-root.cjs');
  const { loadHarnessPolicy } = require('./lib/harness-policy-loader.cjs');
  const { takeNativeQueue, runNativeLintBatch } = require('./lib/native-lint-deferred.cjs');

  // A Stop-time batch is not under the 5s PostToolUse budget — it covers every file
  // edited in the turn and nothing is waiting on it.
  const BATCH_TIMEOUT_MS = parseInt(process.env.BK_NATIVE_LINT_TIMEOUT_MS || '60000', 10);
  const MAX_NAMES_SHOWN = 8;

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

      // Re-entry guard: Claude is continuing because of a Stop hook. Re-linting here
      // is how you build a loop; the queue was drained by the first pass anyway.
      if (data.stop_hook_active === true) {
        timer.end({ status: 'skipped', reason: 'stop_hook_active', exit: 0 });
        process.exit(0);
      }

      const projectRoot = resolveProjectRoot(data);
      const sessionId = data.session_id || data.sessionId || '';

      // Claim + clear in one step. Anything edited after this point queues fresh
      // and is linted at the next Stop.
      const entries = takeNativeQueue(projectRoot, sessionId);
      if (entries.length === 0) {
        timer.end({ status: 'ok', files: 0, exit: 0 });
        process.exit(0);
      }

      let nativeCfg = {};
      try {
        nativeCfg = (loadHarnessPolicy() || {}).native_lint || {};
      } catch { /* fail-open: defaults are fine */ }

      // Group by the platform each entry recorded — no re-detection from the path.
      const byPlatform = new Map();
      for (const entry of entries) {
        const platform = entry && entry.platform;
        if (!platform) continue;
        if (!byPlatform.has(platform)) byPlatform.set(platform, []);
        byPlatform.get(platform).push(entry.file);
      }

      let totalFiles = 0;
      let totalFindings = 0;
      let totalRed = 0;
      let totalYellow = 0;
      let timedOut = 0;

      for (const [platform, files] of byPlatform) {
        const result = await runNativeLintBatch({
          projectRoot,
          platform,
          files,
          policy: nativeCfg,
          timeoutMs: BATCH_TIMEOUT_MS
        });

        totalFiles += result.files;
        totalFindings += result.findings;
        totalRed += result.red;
        totalYellow += result.yellow;
        if (result.timedOut) timedOut += 1;

        if (result.timedOut) {
          process.stderr.write(`[NATIVE-LINT] ${platform}: timed out after ${BATCH_TIMEOUT_MS}ms over ${result.files} file(s)\n`);
        } else if (result.findings > 0) {
          const names = files.map((f) => path.basename(f));
          const shown = names.slice(0, MAX_NAMES_SHOWN).join(', ');
          const extra = names.length > MAX_NAMES_SHOWN ? `, +${names.length - MAX_NAMES_SHOWN} more` : '';
          process.stderr.write(
            `[NATIVE-LINT] ${platform}: ${result.findings} finding(s) across ${result.filesWithFindings} file(s) — ${shown}${extra}\n`
          );
        }
      }

      const status = (timedOut > 0 || totalRed > 0) ? 'warn' : 'ok';
      timer.end({
        status,
        platforms: byPlatform.size,
        files: totalFiles,
        findings: totalFindings,
        red: totalRed,
        yellow: totalYellow,
        exit: 0
      });
      process.exit(0);
    } catch (err) {
      timer.end({ status: 'error', error: err.message, exit: 0 });
      process.exit(0);
    }
  }
  main();
} catch (e) {
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
