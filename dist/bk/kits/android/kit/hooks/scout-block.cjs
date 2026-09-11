#!/usr/bin/env node
// scout-block.cjs - Block broad directory access in mobile projects
// Trigger: PreToolUse (Bash|Glob|Grep)
// Delegates check logic to lib/scout-checker.cjs

'use strict';

// Outer crash wrapper (catches require/parse failures)
try {
  const { createHookTimer } = require('./lib/hook-logger.cjs');
  const { isHookEnabled } = require('./lib/bk-config-utils.cjs');
  const { checkScout } = require('./lib/scout-checker.cjs');

  async function main() {
    const timer = createHookTimer('scout-block');
    try {
      if (!isHookEnabled('scout-block')) {
        timer.end({ status: 'skipped', exit: 0 });
        process.exit(0);
      }

      let input = '';
      for await (const chunk of process.stdin) input += chunk;
      const data = JSON.parse(input || '{}');

      const toolInput = data.tool_input || {};
      const subject = toolInput.command || toolInput.pattern || toolInput.path || '';

      if (!subject) {
        timer.end({ status: 'ok', exit: 0 });
        process.exit(0);
      }

      // Secret scanning for Bash commands with output redirects (CR-P1-03)
      const { getToolName } = require('./lib/hook-event-accessor.cjs');
      const toolName = getToolName(data);
      if (toolName === 'Bash' && subject.length > 50) {
        const hasRedirect = /[>|]|tee\s/.test(subject);
        const hasEcho = /\b(echo|printf|cat\s*<<)\b/.test(subject);
        if (hasRedirect || hasEcho) {
          const SECRET_PATTERNS = [
            { pattern: /AKIA[0-9A-Z]{16}/, label: 'AWS Access Key' },
            { pattern: /-----BEGIN\s(?:RSA\s|EC\s|OPENSSH\s|DSA\s)?PRIVATE KEY-----/, label: 'Private key' },
            { pattern: /(ghp|gho|ghu|ghs|ghr)_[a-zA-Z0-9]{36}/, label: 'GitHub token' },
            { pattern: /sk-ant-[a-zA-Z0-9]{20,}/, label: 'Anthropic API key' },
            { pattern: /sk-[a-zA-Z0-9]{20,}/, label: 'OpenAI API key' },
            { pattern: /xox[baprs]-[0-9]{10,13}-[0-9]{10,13}-[a-zA-Z0-9]{24}/, label: 'Slack token' }
          ];
          for (const { pattern, label } of SECRET_PATTERNS) {
            if (pattern.test(subject)) {
              process.stderr.write(`[SECURITY BLOCK] ${label} detected in Bash command. Do not embed secrets in shell commands.\n`);
              timer.end({ status: 'blocked', tool: label, exit: 2 });
              process.exit(2);
            }
          }
        }
      }

      const result = checkScout(subject);

      if (result) {
        process.stderr.write(
          `[SCOUT BLOCK] Access to "${result.label}" blocked.\n` +
          `This directory is auto-generated and may be very large.\n` +
          `Use more specific paths or targeted search patterns instead.\n`
        );
        timer.end({ status: 'blocked', tool: result.label, exit: 2 });
        process.exit(2);
      }

      timer.end({ status: 'ok', exit: 0 });
      process.exit(0);
    } catch (err) {
      process.stderr.write(`[SCOUT BLOCK] scout-block internal error: ${err.message}\n`);
      timer.end({ status: 'error', error: err.message, exit: 2 });
      process.exit(2);
    }
  }
  main();
} catch (e) {
  try {
    const fs = require('fs');
    const p = require('path');
    const logDir = p.join(__dirname, '.logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    try { const {appendJsonl: _ra} = require('./lib/jsonl-rotator.cjs'); _ra(p.join(logDir, 'hook-log.jsonl'), JSON.stringify({ ts: new Date().toISOString(), hook: 'scout-block', status: 'crash', error: e.message }) + '\n'); }
    catch(_e2) { fs.appendFileSync(p.join(logDir, 'hook-log.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), hook: 'scout-block', status: 'crash', error: e.message }) + '\n'); }
  } catch (_) {}
  // Fail-open on infrastructure errors (require/parse failures).
  // Security blocking only happens inside main() where logic runs.
  // Blocking here would halt ALL Bash/Glob/Grep when hooks dir is broken.
  process.exit(0);
}
