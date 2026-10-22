#!/usr/bin/env node
// privacy-block.cjs - Block access to mobile-sensitive files
// Trigger: PreToolUse (Read|Write|Edit)
// Delegates check logic to lib/privacy-checker.cjs

'use strict';

// Outer crash wrapper (catches require/parse failures)
try {
  const { createHookTimer } = require('./lib/hook-logger.cjs');
  const { isHookEnabled } = require('./lib/bk-config-utils.cjs');
  const { checkPrivacy } = require('./lib/privacy-checker.cjs');
  const { trackViolation } = require('./lib/harness-policy-loader.cjs');

  async function main() {
    const timer = createHookTimer('privacy-block');
    try {
      if (!isHookEnabled('privacy-block')) {
        timer.end({ status: 'skipped', exit: 0 });
        process.exit(0);
      }

      let input = '';
      for await (const chunk of process.stdin) input += chunk;
      const data = JSON.parse(input || '{}');

      const { getToolName, getFilePath } = require('./lib/hook-event-accessor.cjs');
      const filePath = getFilePath(data);

      if (!filePath) {
        timer.end({ status: 'ok', exit: 0 });
        process.exit(0);
      }

      const result = checkPrivacy(filePath);

      if (result) {
        process.stderr.write(`[PRIVACY BLOCK] ${result.reason}\n`);
        trackViolation({ hook: 'privacy-block', violation_type: 'privacy_file', tool: getToolName(data) || 'unknown', target: filePath, blocked: true, severity: 'error', context: { reason: result.reason } });
        timer.end({ status: 'blocked', tool: result.promptData?.basename || 'unknown', exit: 2 });
        process.exit(2);
      }

      timer.end({ status: 'ok', exit: 0 });
      process.exit(0);
    } catch (err) {
      // Under bk-dispatch the happy-path `process.exit(0)` above arrives here as a
      // DispatchExit. Re-throw it: the dispatch runner owns it, and treating it as a failure
      // is what put 748 phantom `internal_error` violations in the field's violations.jsonl.
      if (err && err.bkDispatchExit) throw err;

      process.stderr.write(`[PRIVACY BLOCK] privacy-block internal error: ${err.message}\n`);
      trackViolation({ hook: 'privacy-block', violation_type: 'internal_error', blocked: true, severity: 'error', context: { error: err.message } });
      timer.end({ status: 'error', error: err.message, exit: 2 });
      process.exit(2);
    }
  }
  main();
} catch (e) {
  // A DispatchExit is this hook's own process.exit() unwinding under bk-dispatch, not a
  // crash. Logging it here is how a clean run got filed as `status: "crash"`.
  if (e && e.bkDispatchExit) throw e;

  try {
    const fs = require('fs');
    const p = require('path');
    const logDir = p.join(__dirname, '.logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    try { const {appendJsonl: _ra} = require('./lib/jsonl-rotator.cjs'); _ra(p.join(logDir, 'hook-log.jsonl'), JSON.stringify({ ts: new Date().toISOString(), hook: 'privacy-block', status: 'crash', error: e.message }) + '\n'); }
    catch(_e2) { fs.appendFileSync(p.join(logDir, 'hook-log.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), hook: 'privacy-block', status: 'crash', error: e.message }) + '\n'); }
  } catch (_) {}
  // Fail-open on infrastructure errors (require/parse failures).
  // Privacy blocking only happens inside main() where logic runs.
  process.exit(0);
}
