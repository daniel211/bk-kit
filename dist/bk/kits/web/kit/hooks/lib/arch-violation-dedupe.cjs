/**
 * arch-violation-dedupe.cjs — report an arch-fitness warning once per session window.
 *
 * The fitness hooks run on every Write/Edit and re-scan the whole file, so a warning that is
 * still true (a public func without a doc comment) is reported again after every unrelated edit
 * — and its line number moves as the file grows, so line-keyed dedupe never matches. X-Game-Pro
 * logged `public_api_needs_doc` four times for one function that way.
 *
 * Identity is (rule, file, signature): the signature is the matched source line with whitespace
 * collapsed, else the message. The line is deliberately not part of it.
 *
 * Errors are never suppressed: they block, and must block every time. State is a small tmpdir
 * file per session; a missing or corrupt file means "nothing seen" so a warning is never lost to
 * a state problem. Nothing here throws.
 *
 * Exports: filterRepeatedWarnings, violationKey
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_WINDOW_MS = 30 * 60 * 1000;

function violationKey(v) {
  const sig = String(v.match || v.message || '').replace(/\s+/g, ' ').trim();
  return `${v.ruleId}|${v.filePath}|${sig}`;
}

function statePath(sessionId, cwd) {
  const dir = process.env.BK_ARCH_DEDUPE_DIR || os.tmpdir();
  const id = sessionId
    ? String(sessionId).replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 80)
    : `nosession-${crypto.createHash('sha1').update(String(cwd || process.cwd())).digest('hex').slice(0, 12)}`;
  return path.join(dir, `bk-arch-seen-${id}.json`);
}

/**
 * @param {Array<object>} violations
 * @param {{ sessionId?: string|null, cwd?: string, now?: number, windowMs?: number }} [opts]
 * @returns {Array<object>} violations not already reported inside the window (errors always kept)
 */
function filterRepeatedWarnings(violations, opts = {}) {
  try {
    if (!Array.isArray(violations) || violations.length === 0) return violations || [];
    const now = opts.now || Date.now();
    const windowMs = opts.windowMs > 0 ? opts.windowMs : DEFAULT_WINDOW_MS;
    const file = statePath(opts.sessionId, opts.cwd);

    let seen = {};
    try { seen = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { seen = {}; }
    for (const k of Object.keys(seen)) if (now - seen[k] > windowMs) delete seen[k];

    const fresh = [];
    for (const v of violations) {
      if (v.severity === 'error') { fresh.push(v); continue; }
      const key = violationKey(v);
      if (seen[key] !== undefined) continue; // reported recently — same finding, new line number
      seen[key] = now;
      fresh.push(v);
    }

    try { fs.writeFileSync(file, JSON.stringify(seen), 'utf8'); } catch { /* best-effort */ }
    return fresh;
  } catch {
    return violations; // fail open toward reporting
  }
}

module.exports = { filterRepeatedWarnings, violationKey };
