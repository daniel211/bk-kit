'use strict';
/**
 * metrics-jsonl.cjs — shared reader for the .bk-metrics/*.jsonl logs.
 *
 * Field review 2026-11-01: dashboard.cjs and timeline.cjs each carried their own copy of
 * readJsonlFiltered, and both compared `e.ts >= cutoff` against an epoch-ms cutoff. That
 * works for the four files harness-policy-loader writes (`ts: Date.now()`), but
 * workflow-summary.jsonl writes `ts: new Date().toISOString()`. Comparing a string to a
 * number coerces the string with Number() → NaN, and `NaN >= cutoff` is false, so EVERY
 * summary row was dropped: `workflows.length > 0` in the dashboard's WORKFLOWS panel could
 * never be true, no matter how much the project had run. X-Game-Pro had 8 summary rows on
 * the day the panel showed nothing.
 *
 * Both timestamp formats are legitimate and in use on disk, so the reader accepts either
 * rather than one writer being made to chase the other.
 */

const fs = require('fs');

/**
 * Coerce a metrics `ts` — epoch ms (number or numeric string) or an ISO 8601 string — to
 * epoch ms. Returns null when it is neither, so callers can decide what an undated row means.
 * @param {unknown} ts
 * @returns {number|null}
 */
function normalizeTs(ts) {
  if (typeof ts === 'number') return Number.isFinite(ts) ? ts : null;
  if (typeof ts !== 'string' || ts === '') return null;
  // A numeric string is epoch ms: red-signals.jsonl rows round-trip that way.
  if (/^\d+$/.test(ts)) {
    const n = Number(ts);
    return Number.isFinite(n) ? n : null;
  }
  const parsed = Date.parse(ts);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Read a JSONL metrics file, keeping rows inside `windowMs`.
 *
 * Rows are returned exactly as written — the timestamp is normalized for the comparison
 * only, never rewritten on the row, because renderers read the original `ts`.
 * A row whose `ts` cannot be read as a date is kept: dropping it would hide a writer's bug
 * behind an empty panel, which is the failure this function was fixed for.
 *
 * @param {string} filePath
 * @param {number} [windowMs] — omit or 0 to keep everything
 * @returns {object[]}
 */
function readJsonlFiltered(filePath, windowMs) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  try {
    const cutoff = windowMs ? Date.now() - windowMs : 0;
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw.split('\n').filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter((e) => {
      if (!e) return false;
      if (!windowMs) return true;
      const ts = normalizeTs(e.ts);
      return ts === null ? true : ts >= cutoff;
    });
  } catch { return []; }
}

module.exports = { normalizeTs, readJsonlFiltered };
