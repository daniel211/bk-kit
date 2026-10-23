#!/usr/bin/env node
// post-edit-lint.cjs - PostToolUse hook: RECORD the edited file for end-of-turn lint
// Template variables: android
// Trigger: PostToolUse (Write|Edit)
// Purpose: Append the edited path to this session's lint queue and get out of the way.
//          The linter itself runs once per turn in stop-lint-flush.cjs (Stop event).
//
// This hook used to run the linter inline on every edit — 0.57–1.61s of blocking
// wall time per Write/Edit in a real Flutter project, more than the other 19 hooks
// of an Edit combined. It now does filesystem work only.
//
// Fail-open: never blocks, never exits non-zero.

'use strict';

// Outer crash wrapper (catches require/parse failures)
try {
  const { createHookTimer } = require('./lib/hook-logger.cjs');
  const path = require('path');
  const { isHookEnabled } = require('./lib/bk-config-utils.cjs');
  const { resolveProjectRoot } = require('./lib/resolve-project-root.cjs');
  const { isLintable, resolveQueueFile, enqueueFile } = require('./lib/lint-queue.cjs');

  // Template-injected values
  const PLATFORM = 'android';

  async function main() {
    const timer = createHookTimer('post-edit-lint');
    try {
      if (!isHookEnabled('post-edit-lint')) {
        timer.end({ status: 'skipped', exit: 0 });
        process.exit(0);
      }

      let input = '';
      for await (const chunk of process.stdin) input += chunk;
      const data = JSON.parse(input || '{}');

      const toolInput = data.tool_input || {};
      const filePath = toolInput.file_path || toolInput.path || '';
      if (!filePath) {
        timer.end({ status: 'ok', exit: 0 });
        process.exit(0);
      }

      const platform = PLATFORM || 'unknown';
      const projectRoot = resolveProjectRoot(data);
      const absFile = path.isAbsolute(filePath) ? filePath : path.join(projectRoot, filePath);

      // Only queue files this platform's linter can actually read. Queueing a
      // .md or .json edit would just hand `dart analyze` noise. A composite kit
      // (fullstack) asks which component owns the file, hence the project root.
      if (!isLintable(platform, absFile, projectRoot)) {
        timer.end({ status: 'ok', exit: 0 });
        process.exit(0);
      }

      const queueFile = resolveQueueFile(projectRoot, data.session_id || data.sessionId || '');
      const queued = enqueueFile(queueFile, absFile);

      timer.end({ status: queued ? 'ok' : 'warn', exit: 0 });
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
      JSON.stringify({ ts: new Date().toISOString(), hook: 'post-edit-lint', status: 'crash', error: e.message }) + '\n');
  } catch (_) {}
  // Fail-open: lint hook must never block
  process.exit(0);
}
