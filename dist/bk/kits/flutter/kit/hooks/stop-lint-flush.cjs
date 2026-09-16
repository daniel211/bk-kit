#!/usr/bin/env node
// stop-lint-flush.cjs - Stop hook: lint every file edited during the turn, ONCE
// Template variables: flutter, dart analyze
// Trigger: Stop
// Purpose: Drain this session's lint queue (written by post-edit-lint.cjs), dedupe
//          the paths, drop the ones native-lint-flush is about to analyze with the
//          same tool, run the platform linter a single time over what is left, and
//          report findings as [LINT] warnings on stderr.
//
// One linter run per turn instead of one per edit. Never blocks, never exits
// non-zero, never throws out of the outer wrapper.

'use strict';

// Outer crash wrapper (catches require/parse failures)
try {
  const path = require('path');
  const { createHookTimer } = require('./lib/hook-logger.cjs');
  const { isHookEnabled, loadConfig } = require('./lib/bk-config-utils.cjs');
  const { resolveProjectRoot } = require('./lib/resolve-project-root.cjs');
  const { resolveQueueFile, takeQueue, readQueuedFiles } = require('./lib/lint-queue.cjs');
  const {
    buildBatchCommands, runLintCommand, usesSameBinaryAsNative, NATIVE_SUPERSET_PLATFORMS
  } = require('./lib/lint-batch-runner.cjs');
  const { NATIVE_QUEUE_NAMESPACE } = require('./lib/native-lint-deferred.cjs');

  // Template-injected values
  const PLATFORM = 'flutter';
  const LINT_COMMAND = 'dart analyze';

  // The batch gets its own bound so a pathological analyze cannot hang the end
  // of a turn. Larger than the old per-file 30s because it covers every file.
  const BATCH_TIMEOUT_MS = parseInt(process.env.BK_LINT_TIMEOUT_MS || '60000', 10);
  const MAX_OUTPUT_CHARS = 2000;
  const MAX_NAMES_SHOWN = 8;

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

      // Re-entry guard: Claude is continuing because of a Stop hook. Linting
      // again here is how you build a loop. The queue was already drained by
      // the first pass anyway.
      if (data.stop_hook_active === true) {
        timer.end({ status: 'skipped', reason: 'stop_hook_active', exit: 0 });
        process.exit(0);
      }

      const platform = PLATFORM || 'unknown';
      const projectRoot = resolveProjectRoot(data);
      const sessionId = data.session_id || data.sessionId || '';
      const queueFile = resolveQueueFile(projectRoot, sessionId);

      // Claim + clear in one step. Anything edited after this point queues fresh
      // and gets linted at the next Stop.
      const claimed = takeQueue(queueFile);
      if (claimed.length === 0) {
        timer.end({ status: 'ok', files: 0, exit: 0 });
        process.exit(0);
      }

      // Drop what native-lint-flush is about to analyze anyway.
      //
      // settings.json runs this hook and then native-lint-flush on the same Stop.
      // On ios/flutter both drive the SAME tool and the native command is a strict
      // superset of ours (see NATIVE_SUPERSET_PLATFORMS) — so a file sitting in both
      // queues gets `dart analyze`/`swiftlint` twice in one turn, for one set of
      // findings. Measured in fusionworkomni: 27 runs of each hook in one window.
      //
      // Read-only on purpose: resolveQueueFile + readQueuedFiles, never takeQueue.
      // takeQueue claims by rename, so taking it here would starve native-lint-flush
      // of the very batch we are deferring to.
      //
      // All three gates matter:
      //   - NATIVE_SUPERSET_PLATFORMS is flutter only. android runs different tools
      //     (ktlintCheck vs detekt) and ios loses --strict on the native side, which
      //     would downgrade its warnings from red signals to yellow.
      //   - the configured lint command must drive the same binary the native path
      //     does, or a custom command would be skipped for a run that never covers it.
      //   - if native-lint-flush is disabled, nothing else lints those files at all;
      //     skipping then loses the coverage outright rather than moving it.
      let files = claimed;
      let deferred = 0;
      if (NATIVE_SUPERSET_PLATFORMS.includes(platform)
          && usesSameBinaryAsNative(platform, LINT_COMMAND)
          && isHookEnabled('native-lint-flush')) {
        const nativeQueueFile = resolveQueueFile(projectRoot, sessionId, NATIVE_QUEUE_NAMESPACE);
        const pending = new Set(readQueuedFiles(nativeQueueFile).map((f) => path.resolve(f)));
        if (pending.size > 0) {
          files = claimed.filter((f) => !pending.has(path.resolve(f)));
          deferred = claimed.length - files.length;
        }
      }
      if (files.length === 0) {
        // Everything is covered by the native run moments from now. Distinct status
        // so the dispatch report shows a deferral, not a turn with nothing to lint.
        timer.end({ status: 'deferred_to_native', files: 0, deferred, exit: 0 });
        process.exit(0);
      }

      const cfg = loadConfig() || {};
      const mode = (cfg.lint && cfg.lint.batch) === 'per-file' ? 'per-file' : 'auto';

      const commands = buildBatchCommands({ platform, files, lintCommand: LINT_COMMAND, mode });
      if (commands.length === 0) {
        // Unknown platform / no usable command — nothing to run.
        timer.end({ status: 'ok', files: files.length, deferred, exit: 0 });
        process.exit(0);
      }

      let failures = 0;
      let combined = '';
      for (const cmd of commands) {
        const result = runLintCommand(cmd, { cwd: projectRoot, timeoutMs: BATCH_TIMEOUT_MS });
        if (!result.ok) {
          failures += 1;
          if (result.timedOut) {
            combined += `[LINT] timed out after ${BATCH_TIMEOUT_MS}ms\n`;
          } else if (result.output) {
            combined += result.output;
          }
        }
      }

      if (failures > 0) {
        const names = files.map((f) => path.basename(f));
        const shown = names.slice(0, MAX_NAMES_SHOWN).join(', ');
        const extra = names.length > MAX_NAMES_SHOWN ? `, +${names.length - MAX_NAMES_SHOWN} more` : '';
        process.stderr.write(`[LINT] ${platform} lint warnings for ${files.length} file(s): ${shown}${extra}\n`);
        if (combined) process.stderr.write(combined.slice(0, MAX_OUTPUT_CHARS) + '\n');
        process.stderr.write('[LINT] Continuing — fix lint issues before committing.\n');
        timer.end({ status: 'warn', files: files.length, runs: commands.length, deferred, exit: 0 });
      } else {
        timer.end({ status: 'ok', files: files.length, runs: commands.length, deferred, exit: 0 });
      }

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
      JSON.stringify({ ts: new Date().toISOString(), hook: 'stop-lint-flush', status: 'crash', error: e.message }) + '\n');
  } catch (_) {}
  // Fail-open: lint hook must never block the end of a turn
  process.exit(0);
}
