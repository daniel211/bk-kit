/**
 * advisory-once.cjs — "say this once per workflow", for advisories whose text never changes.
 *
 * The injection budget only dedupes inside a 10-turn window; a "Files:" nag that is right the
 * first time is noise the 27th (X-Game-Pro, 0.13.4: 27 DISPATCH-ADVISORY + 18 PARALLEL-SAFETY
 * in one session). Keyed by session + feature + advisory key, kept in a small tmpdir file.
 *
 * FAIL-OPEN: no session id or any I/O error → true (speak). Never used for blocks.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function stateFile(sessionId) {
  const safe = String(sessionId).replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 80);
  return path.join(process.env.BK_INJECTION_STATE_DIR || os.tmpdir(), `bk-once-${safe}.json`);
}

/**
 * True the first time (sessionId, feature, key) is seen, false afterwards.
 * @param {string} key
 * @param {{sessionId?: string|null, feature?: string|null}} opts
 */
function firstTime(key, opts) {
  try {
    const o = opts || {};
    if (!o.sessionId) return true;
    const file = stateFile(o.sessionId);
    const full = `${o.feature || '-'}|${key}`;
    let seen = {};
    try { seen = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { /* first write */ }
    if (seen[full]) return false;
    seen[full] = Date.now();
    fs.writeFileSync(file, JSON.stringify(seen));
    return true;
  } catch {
    return true;
  }
}

module.exports = { firstTime };
