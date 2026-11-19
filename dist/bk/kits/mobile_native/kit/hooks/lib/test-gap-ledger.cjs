/**
 * test-gap-ledger.cjs — one row per file in test-gaps.jsonl instead of one per edit.
 *
 * test-generation-hook used to append a row on every edit of a source file with no test, so a
 * file edited 20 times logged 20 identical rows (X-Game-Pro: 480 rows, 122 unique files).
 * Now the file's row is updated in place:
 *   timestamp   last time the gap was seen (kept as the window field bk-health filters on)
 *   first_seen  first time the gap was seen
 *   count       how many edits hit the gap
 * `file`, `language`, `reason` and `timestamp` keep their old names and meaning, so existing
 * readers (bk-health behaviour panel) work unchanged. Legacy duplicate rows are merged on the
 * next write. A read-modify-write on a small file, best effort: nothing here throws.
 *
 * Exports: recordTestGap, readUniqueTestGaps
 */

'use strict';

const fs = require('fs');
const path = require('path');

function parseRows(gapFile) {
  let raw = '';
  try { raw = fs.readFileSync(gapFile, 'utf8'); } catch { return []; }
  const rows = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try { const r = JSON.parse(line); if (r && r.file) rows.push(r); } catch { /* skip corrupt line */ }
  }
  return rows;
}

/** Merge rows per file: earliest timestamp -> first_seen, latest -> timestamp, sum of counts. */
function mergeByFile(rows) {
  const byFile = new Map();
  for (const r of rows) {
    const prev = byFile.get(r.file);
    const n = Number.isFinite(r.count) && r.count > 0 ? r.count : 1;
    const first = r.first_seen || r.timestamp;
    if (!prev) { byFile.set(r.file, { ...r, first_seen: first, count: n }); continue; }
    const merged = { ...prev, count: prev.count + n };
    if (first && (!prev.first_seen || first < prev.first_seen)) merged.first_seen = first;
    if (r.timestamp && (!prev.timestamp || r.timestamp > prev.timestamp)) {
      merged.timestamp = r.timestamp; merged.language = r.language || prev.language; merged.reason = r.reason || prev.reason;
    }
    byFile.set(r.file, merged);
  }
  return Array.from(byFile.values());
}

/**
 * Record a gap for entry.file: bump the existing row or add a first-seen one.
 * @param {string} gapFile
 * @param {{timestamp:string,file:string,language:string,reason:string}} entry
 * @returns {boolean} true if this file was new to the ledger
 */
function recordTestGap(gapFile, entry) {
  try {
    const rows = mergeByFile(parseRows(gapFile));
    const idx = rows.findIndex(r => r.file === entry.file);
    const isNew = idx === -1;
    if (isNew) rows.push({ ...entry, first_seen: entry.timestamp, count: 1 });
    else rows[idx] = { ...rows[idx], ...entry, first_seen: rows[idx].first_seen || entry.timestamp, count: rows[idx].count + 1 };
    fs.mkdirSync(path.dirname(gapFile), { recursive: true });
    fs.writeFileSync(gapFile, rows.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');
    return isNew;
  } catch {
    return true; // fail open toward reporting
  }
}

/** @returns {Array<object>} one merged row per file, most-edited first */
function readUniqueTestGaps(gapFile) {
  try {
    return mergeByFile(parseRows(gapFile)).sort((a, b) => b.count - a.count || String(a.file).localeCompare(String(b.file)));
  } catch { return []; }
}

module.exports = { recordTestGap, readUniqueTestGaps };
