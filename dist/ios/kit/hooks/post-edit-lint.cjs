#!/usr/bin/env node
// post-edit-lint.cjs - PostToolUse hook: run platform linter on edited file
// Template variables: ios, swiftlint lint --strict
// Trigger: PostToolUse (Write|Edit)
// Purpose: Surface lint errors as warnings — always fail-open

'use strict';

// Outer crash wrapper (catches require/parse failures)
try {
  const { createHookTimer } = require('./lib/hook-logger.cjs');
  const path = require('path');
  const { execSync } = require('child_process');
  const { isHookEnabled } = require('./lib/bk-config-utils.cjs');
  const { resolveProjectRoot } = require('./lib/resolve-project-root.cjs');

  // Template-injected values
  const PLATFORM = 'ios';
  const LINT_COMMAND = 'swiftlint lint --strict';

  // Default lint commands per platform (fallback if template var not set)
  const DEFAULT_LINT = {
    ios:     (file) => `swiftlint lint --path "${file}"`,
    android: ()     => './gradlew ktlintCheck',
    flutter: (file) => `dart analyze "${file}"`
  };

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
      const lintFn = DEFAULT_LINT[platform];
      if (!lintFn) {
        // Unknown platform — skip lint
        timer.end({ status: 'ok', exit: 0 });
        process.exit(0);
      }

      // Resolve lint command: use template-injected value or default
      const absFile = path.isAbsolute(filePath)
        ? filePath
        : path.join(resolveProjectRoot(), filePath);

      const cmd = (LINT_COMMAND && LINT_COMMAND !== 'swiftlint lint --strict')
        ? LINT_COMMAND.replace('{file}', absFile)
        : lintFn(absFile);

      try {
        execSync(cmd, {
          encoding: 'utf8',
          timeout: 30000,
          stdio: ['pipe', 'pipe', 'pipe'],
          cwd: resolveProjectRoot()
        });
        timer.end({ status: 'ok', exit: 0 });
      } catch (lintErr) {
        // Lint failed — warn only, never block
        const output = (lintErr.stdout || '') + (lintErr.stderr || '');
        process.stderr.write(`[LINT] ${platform} lint warnings for ${path.basename(filePath)}:\n`);
        if (output) process.stderr.write(output.slice(0, 2000) + '\n');
        process.stderr.write(`[LINT] Continuing — fix lint issues before committing.\n`);
        timer.end({ status: 'warn', file: path.basename(filePath), exit: 0 });
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
      JSON.stringify({ ts: new Date().toISOString(), hook: 'post-edit-lint', status: 'crash', error: e.message }) + '\n');
  } catch (_) {}
  // Fail-open: lint hook must never block
  process.exit(0);
}
