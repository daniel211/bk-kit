#!/usr/bin/env node
// write-shrink-guard.cjs - Block a Write that would shrink an existing Markdown file.
// Trigger: PreToolUse (Write)
//
// Write on an existing path replaces it wholesale. An agent that "updates" a long plan by
// regenerating it from memory silently drops every section it failed to reproduce — a
// 517-line doc came back as 126 lines in the field and went unnoticed for days because the
// agent ran in the background. PreToolUse is the only place to catch it: by PostToolUse the
// old content is already gone.

'use strict';

// Outer crash wrapper (catches require/parse failures)
try {
  const fs = require('fs');
  const path = require('path');
  const { createHookTimer } = require('./lib/hook-logger.cjs');
  const { isHookEnabled, loadConfig } = require('./lib/bk-config-utils.cjs');
  const { getToolName, getToolInput, getFilePath } = require('./lib/hook-event-accessor.cjs');
  const { trackViolation } = require('./lib/harness-policy-loader.cjs');

  const DEFAULT_MIN_LINES = 50;
  const DEFAULT_SHRINK_TOLERANCE = 0.25;

  /** Line count that treats a single trailing newline as a terminator, not a line. */
  function countLines(text) {
    if (!text) return 0;
    const body = text.endsWith('\n') ? text.slice(0, -1) : text;
    if (body === '') return 0;
    return body.split('\n').length;
  }

  /** Read a numeric tunable from config, falling back to the default when unusable. */
  function readNumber(value, fallback) {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  async function main() {
    const timer = createHookTimer('write-shrink-guard');
    try {
      if (!isHookEnabled('write-shrink-guard')) {
        timer.end({ status: 'skipped', exit: 0 });
        process.exit(0);
      }

      let input = '';
      for await (const chunk of process.stdin) input += chunk;
      const data = JSON.parse(input || '{}');

      // Write only. Edit is the tool this hook steers toward; everything else is none of
      // its business.
      if (getToolName(data) !== 'Write') {
        timer.end({ status: 'ok', exit: 0 });
        process.exit(0);
      }

      const filePath = getFilePath(data);
      if (!filePath || path.extname(filePath).toLowerCase() !== '.md') {
        timer.end({ status: 'ok', exit: 0 });
        process.exit(0);
      }

      // Phase 1 — fail OPEN. Until an existing, non-empty file is positively read, this
      // hook must not block anything. A guard that crashes the session is worse than the
      // bug it prevents.
      let existing = null;
      try {
        const stat = fs.statSync(filePath);
        if (!stat.isFile() || stat.size === 0) {
          timer.end({ status: 'ok', exit: 0 });
          process.exit(0);
        }
        existing = fs.readFileSync(filePath, 'utf8');
      } catch (readErr) {
        if (readErr && readErr.bkDispatchExit) throw readErr;
        // Missing target = a new file. Anything else = unreadable. Both allow.
        timer.end({ status: 'ok', reason: readErr.code || 'unreadable', exit: 0 });
        process.exit(0);
      }

      const oldLines = countLines(existing);
      const newLines = countLines(getToolInput(data).content || '');

      const cfg = loadConfig();
      const tunables = (cfg && cfg.writeShrinkGuard) || {};
      const minLines = readNumber(tunables.minLines, DEFAULT_MIN_LINES);
      const tolerance = readNumber(tunables.shrinkTolerance, DEFAULT_SHRINK_TOLERANCE);

      if (oldLines >= minLines && newLines < oldLines * (1 - tolerance)) {
        const lost = Math.round(((oldLines - newLines) / oldLines) * 100);
        const basename = path.basename(filePath);
        process.stderr.write(
          `[WRITE SHRINK BLOCK] ${filePath}: ${oldLines} lines -> ${newLines} lines (${lost}% lost).\n` +
          `Write on an existing file replaces it wholesale, so every section not reproduced is gone. ` +
          `To change part of "${basename}", use Edit — it replaces one string in place and leaves the rest untouched.\n` +
          `If the shrink is intended, delete the file first, then Write. Deleting is an unambiguous signal; an undersized Write is not.\n`
        );
        trackViolation({
          hook: 'write-shrink-guard',
          violation_type: 'write_shrink',
          tool: 'Write',
          target: filePath,
          blocked: true,
          severity: 'error',
          context: { old_lines: oldLines, new_lines: newLines, percent_lost: lost }
        });
        timer.end({ status: 'blocked', tool: basename, exit: 2 });
        process.exit(2);
      }

      timer.end({ status: 'ok', exit: 0 });
      process.exit(0);
    } catch (err) {
      // Under bk-dispatch the happy-path process.exit(0) arrives here as a DispatchExit.
      // Re-throw: the dispatch runner owns it (see privacy-block.cjs).
      if (err && err.bkDispatchExit) throw err;

      // Fail open — a parse or fs surprise must not cost the user a tool call.
      timer.end({ status: 'error', error: err.message, exit: 0 });
      process.exit(0);
    }
  }
  main();
} catch (e) {
  if (e && e.bkDispatchExit) throw e;

  try {
    const fs = require('fs');
    const p = require('path');
    const logDir = p.join(__dirname, '.logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const line = JSON.stringify({ ts: new Date().toISOString(), hook: 'write-shrink-guard', status: 'crash', error: e.message }) + '\n';
    try { const { appendJsonl: _ra } = require('./lib/jsonl-rotator.cjs'); _ra(p.join(logDir, 'hook-log.jsonl'), line); }
    catch (_e2) { fs.appendFileSync(p.join(logDir, 'hook-log.jsonl'), line); }
  } catch (_) { /* ignore */ }
  // Fail-open on infrastructure errors (require/parse failures).
  process.exit(0);
}
