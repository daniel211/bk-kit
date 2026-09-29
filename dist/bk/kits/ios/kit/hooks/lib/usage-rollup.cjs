/**
 * usage-rollup.cjs — account-wide usage totals for the statusline
 *
 * Answers two questions the per-project cost ledger cannot: what has this
 * account spent this calendar month, and what has it spent since the current
 * seven-day rate-limit window opened. Both span every project on the machine,
 * so the state lives under `~/.claude/`, not in a project's `.bk-metrics/`.
 *
 * Two files, deliberately:
 *   summary (`.bk-usage-rollup.json`)       — day → cost/tokens. Small; this is
 *                                             the only file the render path reads.
 *   state   (`.bk-usage-rollup-state.json`) — scan cursors + de-duplication keys.
 *                                             Large-ish; only the refresh reads it.
 *
 * Costs are computed from `model-pricing.json`, not billed figures — the same
 * ±15-30% caveat the cost ledger already carries. No effort multiplier is
 * applied: this mirrors what the API charged, not the kit's budget model.
 *
 * Exports: refreshUsageRollup, readUsageRollup, monthStartMs, weekStartMs,
 *          dayKey, defaultPaths
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const { listTranscripts, scanFile } = require('./usage-transcript-scanner.cjs');
const { resolvePricing, computeCost } = require('./token-accurate-parser.cjs');

const SUMMARY_VERSION = 1;
const RETENTION_DAYS = 70;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Fallback pricing for models absent from the table (e.g. a proxied model). */
let _unknownPricing;
function unknownPricing() {
  if (_unknownPricing !== undefined) return _unknownPricing;
  try {
    const table = JSON.parse(fs.readFileSync(path.join(__dirname, 'model-pricing.json'), 'utf8'));
    _unknownPricing = (table.models && table.models.unknown) || null;
  } catch { _unknownPricing = null; }
  return _unknownPricing;
}

/**
 * Default locations. The three env vars exist so tests (and a sandboxed run) can
 * point the rollup at a fixture tree instead of the developer's real history.
 *
 * @returns {{ projectsDir: string, summaryPath: string, statePath: string }}
 */
function defaultPaths() {
  const claudeDir = path.join(os.homedir(), '.claude');
  return {
    projectsDir: process.env.BK_USAGE_PROJECTS_DIR || path.join(claudeDir, 'projects'),
    summaryPath: process.env.BK_USAGE_ROLLUP_SUMMARY || path.join(claudeDir, '.bk-usage-rollup.json'),
    statePath: process.env.BK_USAGE_ROLLUP_STATE || path.join(claudeDir, '.bk-usage-rollup-state.json'),
  };
}

/** Local calendar-day key, `YYYY-MM-DD`. Windows are local, so buckets are too. */
function dayKey(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Start of the current local calendar month. */
function monthStartMs(now = Date.now()) {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

/**
 * Start of the active seven-day window.
 *
 * Claude Code reports when the window resets, which pins the boundary exactly:
 * start = reset − 7d. Without it, fall back to the most recent local Monday and
 * say so, so the caller can label the figure as approximate rather than
 * presenting a guess as fact.
 *
 * @param {{ resetsAtSec?: number|null, now?: number }} opts
 * @returns {{ startMs: number, approx: boolean, resetsAtMs: number|null }}
 */
function weekStartMs({ resetsAtSec = null, now = Date.now() } = {}) {
  if (typeof resetsAtSec === 'number' && resetsAtSec > 0) {
    const resetsAtMs = resetsAtSec * 1000;
    return { startMs: resetsAtMs - WEEK_MS, approx: false, resetsAtMs };
  }
  const d = new Date(now);
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  monday.setDate(monday.getDate() - ((d.getDay() + 6) % 7)); // Sunday = 0 → 6 days back
  return { startMs: monday.getTime(), approx: true, resetsAtMs: null };
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJsonAtomic(file, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value), 'utf8');
    fs.renameSync(tmp, file);
    return true;
  } catch { return false; }
}

/** Short stable key for a request, so the seen-set stays small. */
function entryKey(entry) {
  const req = entry.requestId || '';
  const msg = (entry.message && entry.message.id) || '';
  const raw = `${req}:${msg}`;
  if (!req && !msg) return null; // nothing to de-duplicate on
  let h = 5381;
  for (let i = 0; i < raw.length; i += 1) h = ((h * 33) ^ raw.charCodeAt(i)) >>> 0;
  return `${h.toString(36)}${raw.length.toString(36)}`;
}

/** Cost of one assistant turn, straight from its usage block. */
function entryCost(entry) {
  const message = entry.message || {};
  const usage = message.usage;
  if (!usage) return null;
  const cacheRead = usage.cache_read_input_tokens || 0;
  const cacheCreate = usage.cache_creation_input_tokens || 0;
  const input = usage.input_tokens || 0;
  const output = usage.output_tokens || 0;
  if (!(cacheRead || cacheCreate || input || output)) return null;
  const pricing = resolvePricing(message.model) || unknownPricing();
  return {
    costUsd: computeCost(pricing, cacheRead, cacheCreate, input, output),
    tokensIn: cacheRead + cacheCreate + input,
    tokensOut: output,
  };
}

/**
 * Scan every transcript for lines not yet counted and fold them into the day
 * buckets. Incremental: unchanged files are skipped by size+mtime, changed ones
 * are read from their stored offset onward.
 *
 * @param {object} [opts]
 * @param {string} [opts.projectsDir]
 * @param {string} [opts.summaryPath]
 * @param {string} [opts.statePath]
 * @param {number|null} [opts.resetsAtSec] — latest `rate_limits.seven_day.resets_at`
 * @param {number} [opts.now]
 * @param {number} [opts.retentionDays]
 * @returns {{ summary: object, filesScanned: number, entriesAdded: number }}
 */
function refreshUsageRollup(opts = {}) {
  const paths = { ...defaultPaths(), ...opts };
  const now = opts.now || Date.now();
  const retentionDays = opts.retentionDays || RETENTION_DAYS;

  const summary = readJson(paths.summaryPath, null) || { version: SUMMARY_VERSION, days: {} };
  if (summary.version !== SUMMARY_VERSION || !summary.days) { summary.version = SUMMARY_VERSION; summary.days = {}; }
  const state = readJson(paths.statePath, null) || { version: SUMMARY_VERSION, files: {}, seen: {} };
  if (!state.files) state.files = {};
  if (!state.seen) state.seen = {};
  if (!state.outs) state.outs = {};

  // Remember the newest reset we have seen, so the week window survives a
  // payload that omits rate_limits entirely.
  if (typeof opts.resetsAtSec === 'number' && opts.resetsAtSec > 0) {
    if (!summary.resetsAt || opts.resetsAtSec > summary.resetsAt) summary.resetsAt = opts.resetsAtSec;
  }

  const cutoffDay = dayKey(now - retentionDays * 24 * 60 * 60 * 1000);
  let filesScanned = 0;
  let entriesAdded = 0;

  const files = listTranscripts(paths.projectsDir);
  const alive = new Set(files);

  for (const file of files) {
    let stat;
    try { stat = fs.statSync(file); } catch { continue; }
    const prev = state.files[file];
    if (prev && prev.size === stat.size && prev.mtime === stat.mtimeMs) continue;

    const fromOffset = prev && stat.size >= prev.size ? (prev.offset || 0) : 0;
    filesScanned += 1;

    const { offset } = scanFile(file, fromOffset, (entry) => {
      if (!entry || entry.type !== 'assistant' || !entry.timestamp) return;
      const ts = Date.parse(entry.timestamp);
      if (!Number.isFinite(ts)) return;
      const day = dayKey(ts);
      if (day < cutoffDay) return; // outside the retained window — nothing can read it

      const key = entryKey(entry);
      const cost = entryCost(entry);
      if (!cost) return;

      if (key && state.seen[key]) {
        // Same request seen again — via another transcript, or as the final row that follows a
        // streaming placeholder (same message.id, small output_tokens). Input and cache figures
        // repeat across those rows, so only an output increase is new: fold in just the delta.
        const prevOut = state.outs[key] || 0;
        const delta = cost.tokensOut - prevOut;
        if (delta > 0) {
          const dayBucket = summary.days[state.seen[key]];
          if (dayBucket) {
            const pricing = resolvePricing(entry.message.model) || unknownPricing();
            dayBucket.costUsd = Math.round((dayBucket.costUsd + computeCost(pricing, 0, 0, 0, delta)) * 1e8) / 1e8;
            dayBucket.tokensOut += delta;
          }
          state.outs[key] = cost.tokensOut;
        }
        return;
      }

      const bucket = summary.days[day] || (summary.days[day] = { costUsd: 0, tokensIn: 0, tokensOut: 0, entries: 0 });
      bucket.costUsd = Math.round((bucket.costUsd + cost.costUsd) * 1e8) / 1e8;
      bucket.tokensIn += cost.tokensIn;
      bucket.tokensOut += cost.tokensOut;
      bucket.entries += 1;
      if (key) { state.seen[key] = day; state.outs[key] = cost.tokensOut; }
      entriesAdded += 1;
    });

    state.files[file] = { size: stat.size, mtime: stat.mtimeMs, offset };
  }

  // Prune: days past retention, their de-duplication keys, and cursors for
  // transcripts that no longer exist.
  for (const day of Object.keys(summary.days)) if (day < cutoffDay) delete summary.days[day];
  for (const [key, day] of Object.entries(state.seen)) if (day < cutoffDay) { delete state.seen[key]; delete state.outs[key]; }
  for (const file of Object.keys(state.files)) if (!alive.has(file)) delete state.files[file];

  summary.updated = now;
  writeJsonAtomic(paths.summaryPath, summary);
  writeJsonAtomic(paths.statePath, state);

  return { summary, filesScanned, entriesAdded };
}

/**
 * Read the totals. One small file read, no scanning — safe on the render path.
 *
 * @param {object} [opts]
 * @param {string} [opts.summaryPath]
 * @param {number} [opts.now]
 * @param {number|null} [opts.resetsAtSec] — live value from the statusline payload
 * @returns {{ mtdUsd: number|null, weekUsd: number|null, weekApprox: boolean,
 *             resetsAtMs: number|null, updated: number|null, staleMs: number|null }}
 */
function readUsageRollup(opts = {}) {
  const summaryPath = opts.summaryPath || defaultPaths().summaryPath;
  const now = opts.now || Date.now();
  const empty = {
    mtdUsd: null, weekUsd: null, weekApprox: true,
    resetsAtMs: null, updated: null, staleMs: null,
  };

  const summary = readJson(summaryPath, null);
  if (!summary || summary.version !== SUMMARY_VERSION || !summary.days) return empty;

  const resetsAtSec = (typeof opts.resetsAtSec === 'number' && opts.resetsAtSec > 0)
    ? opts.resetsAtSec
    : (summary.resetsAt || null);
  const week = weekStartMs({ resetsAtSec, now });
  const monthStart = monthStartMs(now);
  const monthKey = dayKey(monthStart);
  const weekKey = dayKey(week.startMs);

  // Buckets are whole local days, so the week total includes all of the day the
  // window opened rather than starting mid-day. Erring high is the safe side of
  // a spend figure; the exact boundary would need per-entry timestamps, which is
  // precisely the scanning this file exists to keep off the render path.
  let mtdUsd = 0;
  let weekUsd = 0;
  for (const [day, bucket] of Object.entries(summary.days)) {
    const cost = (bucket && bucket.costUsd) || 0;
    if (day >= monthKey) mtdUsd += cost;
    if (day >= weekKey) weekUsd += cost;
  }

  return {
    mtdUsd: Math.round(mtdUsd * 1e4) / 1e4,
    weekUsd: Math.round(weekUsd * 1e4) / 1e4,
    weekApprox: week.approx,
    resetsAtMs: week.resetsAtMs,
    updated: summary.updated || null,
    staleMs: summary.updated ? now - summary.updated : null,
  };
}

module.exports = {
  refreshUsageRollup,
  readUsageRollup,
  monthStartMs,
  weekStartMs,
  dayKey,
  defaultPaths,
  SUMMARY_VERSION,
};
