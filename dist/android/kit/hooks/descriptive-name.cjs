#!/usr/bin/env node
// descriptive-name.cjs - PreToolUse hook: validate file naming conventions per platform
// Template variables: android, PascalCase
// Trigger: PreToolUse (Write|Edit)
// Purpose: Warn when filenames don't match platform convention — always fail-open

'use strict';

// Outer crash wrapper (catches require/parse failures)
try {
  const { createHookTimer } = require('./lib/hook-logger.cjs');
  const path = require('path');
  const { isHookEnabled } = require('./lib/bk-config-utils.cjs');

  // Template-injected values
  const PLATFORM = 'android';
  const NAMING_CONVENTION = 'PascalCase';

  // Per-platform naming rules: { extensions, pattern, label }
  const NAMING_RULES = {
    ios:     { exts: ['.swift'],       pattern: /^[A-Z][A-Za-z0-9]*\.swift$/, label: 'PascalCase' },
    android: { exts: ['.kt', '.java'], pattern: /^[A-Z][A-Za-z0-9]*\.(kt|java)$/, label: 'PascalCase' },
    flutter: { exts: ['.dart'],        pattern: /^[a-z][a-z0-9_]*\.dart$/, label: 'snake_case' }
  };

  async function main() {
    const timer = createHookTimer('descriptive-name');
    try {
      if (!isHookEnabled('descriptive-name')) {
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

      const basename = path.basename(filePath);
      const platform = (PLATFORM && !PLATFORM.startsWith('{{')) ? PLATFORM : 'unknown';
      const rule = NAMING_RULES[platform];

      // No rule for this platform — skip silently
      if (!rule) {
        timer.end({ status: 'ok', exit: 0 });
        process.exit(0);
      }

      const ext = path.extname(basename);
      if (!rule.exts.includes(ext)) {
        // Not a file type we validate for this platform
        timer.end({ status: 'ok', exit: 0 });
        process.exit(0);
      }

      const convention = NAMING_CONVENTION || rule.label;
      if (!rule.pattern.test(basename)) {
        // Warn only — never block (fail-open)
        process.stderr.write(
          `[NAMING] Warning: "${basename}" doesn't match ${platform} ${convention} convention.\n` +
          `  Expected pattern: ${rule.pattern}\n` +
          `  Continuing — fix name if this is a new file.\n`
        );
        timer.end({ status: 'warn', file: basename, exit: 0 });
      } else {
        timer.end({ status: 'ok', exit: 0 });
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
      JSON.stringify({ ts: new Date().toISOString(), hook: 'descriptive-name', status: 'crash', error: e.message }) + '\n');
  } catch (_) {}
  // Fail-open: naming validation must never block
  process.exit(0);
}
