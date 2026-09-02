#!/usr/bin/env node
// security-check.cjs - Block writes to protected files and scan for secrets
// Trigger: PreToolUse (Write|Edit)
// Rewritten from package/.claude/hooks/security-check.sh

'use strict';

// Outer crash wrapper (catches require/parse failures)
try {
  const { createHookTimer } = require('./lib/hook-logger.cjs');
  const path = require('path');
  const { isHookEnabled } = require('./lib/bk-config-utils.cjs');
  const { checkPrivacy } = require('./lib/privacy-checker.cjs');
  const { trackViolation } = require('./lib/harness-policy-loader.cjs');

  async function main() {
    const timer = createHookTimer('security-check');
    try {
      if (!isHookEnabled('security-check')) {
        timer.end({ status: 'skipped', exit: 0 });
        process.exit(0);
      }

      let input = '';
      for await (const chunk of process.stdin) input += chunk;
      const data = JSON.parse(input || '{}');

      // Only enforce on Write/Edit — skip Read (privacy-block handles Read consent)
      const { getToolName, getToolInput, getFilePath } = require('./lib/hook-event-accessor.cjs');
      const toolName = getToolName(data);
      if (toolName === 'Read') {
        timer.end({ status: 'ok', exit: 0 });
        process.exit(0);
      }

      const toolInput = getToolInput(data);
      const filePath = getFilePath(data);
      const basename = filePath ? path.basename(filePath) : '';
      const lower = filePath.toLowerCase();

      // --- 1. PROTECTED FILES (block immediately) ---
      // Reuse privacy-checker for shared protected file list (CR-P1-04)
      const privacyResult = checkPrivacy(filePath);
      if (privacyResult) {
        process.stderr.write(`[SECURITY BLOCK] Protected file — writes to "${basename}" are not allowed. ${privacyResult.reason}\n`);
        trackViolation({ hook: 'security-check', violation_type: 'protected_file', tool: toolName, target: filePath, blocked: true, severity: 'error', context: { reason: privacyResult.reason } });
        timer.end({ status: 'blocked', tool: basename, exit: 2 });
        process.exit(2);
      }

      // Security-specific extras not in privacy-checker
      const SECURITY_NAMES = new Set(['local.properties', 'secrets.json', 'credentials.json']);
      const LOCK_FILES = new Set(['Package.resolved']);
      const isSecretExt = basename.toLowerCase().endsWith('.secret');

      if (SECURITY_NAMES.has(basename) || isSecretExt) {
        process.stderr.write(`[SECURITY BLOCK] Protected file — writes to "${basename}" are not allowed. This file may contain secrets or credentials.\n`);
        trackViolation({ hook: 'security-check', violation_type: 'secrets_file', tool: toolName, target: filePath, blocked: true, severity: 'error', context: { basename } });
        timer.end({ status: 'blocked', tool: basename, exit: 2 });
        process.exit(2);
      }

      if (LOCK_FILES.has(basename)) {
        process.stderr.write(`[SECURITY BLOCK] Lock file "${basename}" must not be edited manually. Let the package manager manage it.\n`);
        trackViolation({ hook: 'security-check', violation_type: 'lock_file', tool: toolName, target: filePath, blocked: true, severity: 'error', context: { basename } });
        timer.end({ status: 'blocked', tool: basename, exit: 2 });
        process.exit(2);
      }

      // --- 2. SECRET SCAN on content being written ---
      const content = toolInput.new_string || toolInput.content || '';
      if (!content || content.length === 0) {
        timer.end({ status: 'ok', exit: 0 });
        process.exit(0);
      }

      // Truncate large content to first 100KB
      const scanContent = content.length > 100000 ? content.slice(0, 100000) : content;

      const SECRET_PATTERNS = [
        { pattern: /AKIA[0-9A-Z]{16}/, label: 'AWS Access Key' },
        { pattern: /-----BEGIN\s(?:RSA\s|EC\s|OPENSSH\s|DSA\s)?PRIVATE KEY-----/, label: 'Private key' },
        { pattern: /(ghp|gho|ghu|ghs|ghr)_[a-zA-Z0-9]{36}/, label: 'GitHub token' },
        { pattern: /xox[baprs]-[0-9]{10,13}-[0-9]{10,13}-[a-zA-Z0-9]{24}/, label: 'Slack token' },
        { pattern: /sk-ant-[a-zA-Z0-9]{20,}/, label: 'Anthropic API key' },
        { pattern: /sk-[a-zA-Z0-9]{20,}(?<!sk-ant-[a-zA-Z0-9]{20,})/, label: 'OpenAI API key' },
        { pattern: /"type"\s*:\s*"service_account"/, label: 'GCP service account key' },
        { pattern: /DefaultEndpointsProtocol=https;AccountName=/, label: 'Azure connection string' },
        { pattern: /AIza[0-9A-Za-z_-]{35}/, label: 'Google/Firebase API key' }
      ];

      for (const { pattern, label } of SECRET_PATTERNS) {
        if (pattern.test(scanContent)) {
          process.stderr.write(`[SECURITY BLOCK] ${label} detected in content. Remove secrets before writing. Use environment variables or a secrets manager instead.\n`);
          trackViolation({ hook: 'security-check', violation_type: 'secret_in_content', tool: toolName, target: filePath, blocked: true, severity: 'error', context: { label } });
          timer.end({ status: 'blocked', tool: label, exit: 2 });
          process.exit(2);
        }
      }

      // --- 3. WARNINGS (non-blocking) ---
      const WARN_PATTERNS = [
        /(?:api[_-]?key|password|secret|token)\s*[=:]\s*["'][a-zA-Z0-9_\-]{20,}["']/i,
        /eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*/   // JWT
      ];

      for (const pattern of WARN_PATTERNS) {
        if (pattern.test(scanContent)) {
          process.stderr.write('[SECURITY WARN] Possible hardcoded secret — consider using environment variables.\n');
          break;
        }
      }

      timer.end({ status: 'ok', exit: 0 });
      process.exit(0);
    } catch (err) {
      process.stderr.write(`[SECURITY BLOCK] security-check internal error: ${err.message}\n`);
      trackViolation({ hook: 'security-check', violation_type: 'internal_error', blocked: true, severity: 'error', context: { error: err.message } });
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
    try { const {appendJsonl: _ra} = require('./lib/jsonl-rotator.cjs'); _ra(p.join(logDir, 'hook-log.jsonl'), JSON.stringify({ ts: new Date().toISOString(), hook: 'security-check', status: 'crash', error: e.message }) + '\n'); }
    catch(_e2) { fs.appendFileSync(p.join(logDir, 'hook-log.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), hook: 'security-check', status: 'crash', error: e.message }) + '\n'); }
  } catch (_) {}
  // Fail-open on infrastructure errors (require/parse failures).
  // Security blocking only happens inside main() where logic runs.
  process.exit(0);
}
