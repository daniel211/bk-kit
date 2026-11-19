/**
 * untracked-repeat-guard.cjs — has post-commit already warned about exactly this untracked set?
 *
 * Why: field review of fusionworkomni (2026-10-18) showed the same 9-10 `.claude/agent-memory/*`
 * files reported after every one of ~25 consecutive commits. The warning text embeds the commit
 * hash, so injection-budget's content-hash dedupe never matched, and each commit also wrote a
 * fresh `untracked_after_commit` yellow signal. Nobody acts on the 20th copy of a warning.
 *
 * The key is the sorted file list, so a NEW untracked file changes the key and warns again in full.
 * State lives in os.tmpdir() per session. FAIL-OPEN: any error means "not a repeat" (warn in full).
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

/** Stable key for a set of untracked paths (order-independent). */
function setKey(files) {
  return crypto.createHash('sha1').update([...files].sort().join('\n')).digest('hex').slice(0, 16);
}

function statePath(sessionId) {
  const safe = String(sessionId || 'nosession').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
  return path.join(os.tmpdir(), `bk-untracked-repeat-${safe}.json`);
}

/**
 * Record this commit's untracked set and say whether the previous commit in the session had
 * the identical one.
 * @param {string[]} files untracked paths after the commit
 * @param {string|null|undefined} sessionId
 * @returns {boolean} true when the set is unchanged since the last warning
 */
function isRepeatAndRecord(files, sessionId) {
  if (!sessionId || !files.length) return false;
  const key = setKey(files);
  const file = statePath(sessionId);
  let repeat = false;
  try {
    repeat = JSON.parse(fs.readFileSync(file, 'utf8')).key === key;
  } catch { /* no state yet — first warning */ }
  try {
    if (!repeat) fs.writeFileSync(file, JSON.stringify({ key, ts: Date.now() }));
  } catch { /* best-effort */ }
  return repeat;
}

module.exports = { isRepeatAndRecord, setKey };
