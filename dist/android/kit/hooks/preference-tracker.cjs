#!/usr/bin/env node
// preference-tracker.cjs - Track user behavior patterns from AskUser responses
// Trigger: PostToolUse (matcher: .*AskUser.*)
// Purpose: Build .bk-preferences.json from observed user choices
// Non-blocking (exit 0). Pure file generation — no stdout output.

'use strict';

// Outer crash wrapper
try {
  const { createHookTimer } = require('./lib/hook-logger.cjs');
  const fs = require('fs');
  const path = require('path');
  const { resolveProjectRoot } = require('./lib/resolve-project-root.cjs');

  async function main() {
    const timer = createHookTimer('preference-tracker');
    try {
      const { isHookEnabled } = require('./lib/bk-config-utils.cjs');

      if (!isHookEnabled('preference-tracker')) {
        timer.end({ status: 'skipped', exit: 0 });
        process.exit(0);
      }

      // Parse stdin — look for tool output containing user responses
      let input = '';
      for await (const chunk of process.stdin) input += chunk;

      let data = {};
      try {
        data = JSON.parse(input || '{}');
      } catch { /* non-JSON stdin, continue */ }

      // Extract tool output / user response text
      const toolOutput = (
        data.tool_output ||
        data.output ||
        data.result ||
        (typeof data === 'string' ? data : '')
      );
      const responseText = (typeof toolOutput === 'string' ? toolOutput : JSON.stringify(toolOutput || '')).toLowerCase();

      // Read existing preferences or start fresh
      const prefsPath = path.join(resolveProjectRoot(), '.bk-preferences.json');
      let prefs = {
        docs_skip_count: 0,
        auto_approve_count: 0,
        fast_mode_count: 0,
        total_count: 0,
        docs_priority: 'medium',
        approval_style: 'gate',
        updated_at: null
      };

      if (fs.existsSync(prefsPath)) {
        try {
          const existing = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
          prefs = { ...prefs, ...existing };
        } catch { /* use defaults */ }
      }

      // Increment total interactions
      prefs.total_count += 1;

      // Detect patterns in user response
      const skipPatterns = /\b(skip|no|not now|later|ignore|cancel|bỏ qua|không)\b/i;
      const approvePatterns = /\b(approve|yes|ok|confirm|proceed|go|tiến hành|đồng ý)\b/i;
      const fastPatterns = /--fast|fast mode|nhanh|quick/i;

      if (skipPatterns.test(responseText)) {
        prefs.docs_skip_count += 1;
      }
      if (approvePatterns.test(responseText)) {
        prefs.auto_approve_count += 1;
      }
      if (fastPatterns.test(responseText)) {
        prefs.fast_mode_count += 1;
      }

      // After 5+ data points, derive preferences
      if (prefs.total_count >= 5) {
        const skipRatio = prefs.docs_skip_count / prefs.total_count;
        const approveRatio = prefs.auto_approve_count / prefs.total_count;

        prefs.docs_priority = skipRatio > 0.5 ? 'low' : 'medium';
        prefs.approval_style = approveRatio > 0.6 ? 'auto' : 'gate';
      }

      prefs.updated_at = new Date().toISOString();

      // Write .bk-preferences.json
      fs.writeFileSync(prefsPath, JSON.stringify(prefs, null, 2));

      timer.end({ status: 'ok', total: prefs.total_count, exit: 0 });
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
    try { const {appendJsonl: _ra} = require('./lib/jsonl-rotator.cjs'); _ra(p.join(logDir, 'hook-log.jsonl'), JSON.stringify({ ts: new Date().toISOString(), hook: 'preference-tracker', status: 'crash', error: e.message }) + '\n'); }
    catch(_e2) { fs.appendFileSync(p.join(logDir, 'hook-log.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), hook: 'preference-tracker', status: 'crash', error: e.message }) + '\n'); }
  } catch (_) {}
  process.exit(0); // Fail-open
}
