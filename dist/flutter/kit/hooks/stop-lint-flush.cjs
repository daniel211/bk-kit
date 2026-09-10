#!/usr/bin/env node
// stop-lint-flush.cjs - Stop hook: lint every file edited during the turn, ONCE
// Template variables: flutter, dart analyze
// Trigger: Stop
// Purpose: Drain this session's lint queue (written by post-edit-lint.cjs), dedupe
//          the paths, run the platform linter a single time over the whole batch,
//          and report findings as [LINT] warnings on stderr.
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
  const { resolveQueueFile, takeQueue } = require('./lib/lint-queue.cjs');
  const { buildBatchCommands, runLintCommand } = require('./lib/lint-batch-runner.cjs');

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
      const queueFile = resolveQueueFile(projectRoot, data.session_id || data.sessionId || '');

      // Claim + clear in one step. Anything edited after this point queues fresh
      // and gets linted at the next Stop.
      const files = takeQueue(queueFile);
      if (files.length === 0) {
        timer.end({ status: 'ok', files: 0, exit: 0 });
        process.exit(0);
      }

      const cfg = loadConfig() || {};
      const mode = (cfg.lint && cfg.lint.batch) === 'per-file' ? 'per-file' : 'auto';

      const commands = buildBatchCommands({ platform, files, lintCommand: LINT_COMMAND, mode });
      if (commands.length === 0) {
        // Unknown platform / no usable command — nothing to run.
        timer.end({ status: 'ok', files: files.length, exit: 0 });
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
        timer.end({ status: 'warn', files: files.length, runs: commands.length, exit: 0 });
      } else {
        timer.end({ status: 'ok', files: files.length, runs: commands.length, exit: 0 });
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
