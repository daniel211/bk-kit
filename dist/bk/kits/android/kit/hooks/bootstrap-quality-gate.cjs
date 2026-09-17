#!/usr/bin/env node
// bootstrap-quality-gate.cjs - Validate foundation docs quality after bootstrap
// Trigger: PostToolUse (Write) — only when writing to bk/docs/foundation/

'use strict';

// Outer crash wrapper (catches require/parse failures)
try {
  const { createHookTimer } = require('./lib/hook-logger.cjs');

  async function main() {
    const timer = createHookTimer('bootstrap-quality-gate');
    try {
      const fs = require('fs');
      const path = require('path');
      const { isHookEnabled } = require('./lib/bk-config-utils.cjs');

      if (!isHookEnabled('bootstrap-quality-gate')) {
        timer.end({ status: 'skipped', exit: 0 });
        process.exit(0);
      }

      let input = '';
      for await (const chunk of process.stdin) input += chunk;
      const data = JSON.parse(input || '{}');

      const toolInput = data.tool_input || {};
      const filePath = toolInput.file_path || toolInput.path || '';

      // Only trigger for foundation docs
      if (!filePath.includes('bk/docs/foundation/')) {
        timer.end({ status: 'skipped', exit: 0 });
        process.exit(0);
      }

      if (!fs.existsSync(filePath)) {
        timer.end({ status: 'ok', exit: 0 });
        process.exit(0);
      }

      const warnings = [];
      const errors = [];

      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');
      const fileName = path.basename(filePath);

      // --- 1. Minimum line counts per file type ---
      const minLines = {
        'overview.md': 40,
        'architecture.md': 50,
        'code-guidelines.md': 40,
        'dependencies.md': 25,
        'build-targets.md': 25,
        'design-system.md': 20,
        'project-roadmap.md': 20,
      };

      const requiredMin = minLines[fileName] || 20;
      if (lines.length < requiredMin) {
        warnings.push(`[BOOTSTRAP-QUALITY] ${fileName} too thin: ${lines.length} lines (min ${requiredMin}). Add more detail from scan results.`);
      }

      // --- 2. Check table completeness (>30% empty = warning) ---
      const tableRows = lines.filter(l => l.startsWith('|') && !l.startsWith('|--'));
      const emptyCells = tableRows.filter(l => /\|\s*\|/.test(l) || /\|\s*Not detected\s*\|/i.test(l));
      if (tableRows.length > 0 && emptyCells.length > tableRows.length * 0.3) {
        warnings.push(`[BOOTSTRAP-QUALITY] ${fileName} has ${emptyCells.length}/${tableRows.length} empty/undetected table cells. Re-scan needed.`);
      }

      // --- 3. Check evidence citations in architecture + code-guidelines ---
      if (['architecture.md', 'code-guidelines.md'].includes(fileName)) {
        const hasEvidence = /Evidence|evidence|file:|line:|Found in:|See |\/\w+\.\w+|\d+ files/i.test(content);
        if (!hasEvidence) {
          warnings.push(`[BOOTSTRAP-QUALITY] ${fileName} lacks evidence citations. Every pattern must cite file + line.`);
        }
      }

      // --- Build output ---
      if (errors.length === 0 && warnings.length === 0) {
        timer.end({ status: 'ok', exit: 0 });
        process.exit(0);
      }

      const allLines = [...errors, ...warnings];

      // Advisory context is subject to the shared injection budget (cap + dedupe). Optional:
      // if the lib is absent the text goes out unchanged.
      let text = allLines.join('\n');
      try {
        const injectionBudget = require('./lib/injection-budget.cjs');
        text = injectionBudget.prepareInjection('bootstrap-quality-gate', text, {
          sessionId: injectionBudget.sessionIdFrom(data)
        });
      } catch { /* optional lib — keep the full text */ }

      if (text) process.stdout.write(JSON.stringify({ additionalContext: text }) + '\n');

      timer.end({ status: warnings.length > 0 ? 'warn' : 'error', exit: 0 });
      process.exit(0);
    } catch (err) {
      timer.end({ status: 'error', error: err.message, exit: 0 });
      process.exit(0);
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
    try { const {appendJsonl: _ra} = require('./lib/jsonl-rotator.cjs'); _ra(p.join(logDir, 'hook-log.jsonl'), JSON.stringify({ ts: new Date().toISOString(), hook: 'bootstrap-quality-gate', status: 'crash', error: e.message }) + '\n'); }
    catch(_e2) { fs.appendFileSync(p.join(logDir, 'hook-log.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), hook: 'bootstrap-quality-gate', status: 'crash', error: e.message }) + '\n'); }
  } catch (_) {}
  process.exit(0);
}
