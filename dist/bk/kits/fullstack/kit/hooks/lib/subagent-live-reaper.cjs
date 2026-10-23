'use strict';
/**
 * subagent-live-reaper.cjs — Close out subagents that never emitted SubagentStop.
 *
 * A Task dispatch writes a `spawn` row to .bk-metrics/subagent-live.jsonl and the matching
 * SubagentStop writes a `stop` row. When the agent is interrupted — the user hits escape,
 * the session dies, the CLI is killed — SubagentStop never fires and the spawn stays open
 * forever. The field file that prompted this had 19 spawns against 18 stops: one
 * `bk-git-manager` dispatched at 2026-09-16T01:47:08Z was still being rendered by the
 * statusline as `🤖 bk-git-manager(8100s)` two and a quarter hours later, and nothing
 * anywhere would ever have closed it. Cost and metrics rollups counted it as in flight too.
 *
 * This reaps on the data side: one synthetic `stop` per orphan, marked `reaped: true` with
 * null usage figures, so the row is unmistakably not a measurement. The statusline's own
 * TTL cutoff (which imports SUBAGENT_STALE_TTL_MS from here) handles display; this handles
 * the file everything else reads.
 *
 * Fail-open in the strongest sense: never throws, never exits, returns 0 on any problem.
 */

const fs = require('fs');
const path = require('path');
const { appendJsonl } = require('./jsonl-rotator.cjs');

/**
 * How old an unmatched spawn must be before it is considered abandoned.
 *
 * 45 minutes. The longest genuine agent run observed in this project's own metrics is
 * 1,156,822 ms (~19 minutes), so 45 minutes sits comfortably above any real run while still
 * being far below the 2h15m a stuck spawn was displayed for. Shared with statusline.cjs
 * rather than duplicated, so display and data can never disagree about what "stale" means.
 */
const SUBAGENT_STALE_TTL_MS = 45 * 60 * 1000;

/**
 * Parse a JSONL file into rows, skipping anything unparseable.
 *
 * @param {string} filePath
 * @returns {Array<object>}
 */
function readRows(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean);
  } catch {
    return []; // no file yet, or unreadable — nothing to reap
  }
}

/**
 * Find spawns with no matching stop that are older than the TTL.
 *
 * A stop claims a spawn by `subagent_id`. Stops without one (older records) fall back to
 * claiming the oldest unclaimed spawn of the same name — the same enrichment rule
 * subagent-live-tracker.cjs uses, so the two agree on what "unmatched" means.
 *
 * @param {Array<object>} rows
 * @param {number} nowMs
 * @param {number} ttlMs
 * @returns {Array<object>} orphaned spawn rows, in file order
 */
function findOrphans(rows, nowMs, ttlMs) {
  const spawns = [];
  const claimedIds = new Set();
  const stopsByName = new Map(); // name → count of stops carrying no subagent_id

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    if (row.event === 'spawn' && row.subagent_id) {
      spawns.push(row);
    } else if (row.event === 'stop') {
      if (row.subagent_id) claimedIds.add(row.subagent_id);
      else {
        const name = row.name || 'unknown';
        stopsByName.set(name, (stopsByName.get(name) || 0) + 1);
      }
    }
  }

  const orphans = [];
  for (const spawn of spawns) {
    if (claimedIds.has(spawn.subagent_id)) continue;

    // An id-less stop for this name absorbs one unmatched spawn.
    const name = spawn.name || 'unknown';
    const loose = stopsByName.get(name) || 0;
    if (loose > 0) { stopsByName.set(name, loose - 1); continue; }

    const spawnedAt = spawn.ts ? Date.parse(spawn.ts) : NaN;
    if (Number.isNaN(spawnedAt)) continue;     // no usable timestamp — leave it alone
    if (nowMs - spawnedAt < ttlMs) continue;   // still plausibly running

    orphans.push(spawn);
  }
  return orphans;
}

/**
 * Reap orphaned spawns in a project's subagent-live.jsonl.
 *
 * Idempotent: each synthetic stop carries the orphan's `subagent_id`, so the next run sees
 * that spawn as claimed and appends nothing.
 *
 * @param {string} root — project root (the directory holding .bk-metrics/)
 * @param {{ ttlMs?: number, now?: number }} [options]
 * @returns {number} how many synthetic stops were appended (0 on any failure)
 */
function reapOrphanedSubagents(root, options = {}) {
  try {
    if (!root || typeof root !== 'string') return 0;
    const ttlMs = typeof options.ttlMs === 'number' ? options.ttlMs : SUBAGENT_STALE_TTL_MS;
    const nowMs = typeof options.now === 'number' ? options.now : Date.now();

    const liveFile = path.join(root, '.bk-metrics', 'subagent-live.jsonl');
    if (!fs.existsSync(liveFile)) return 0;

    const orphans = findOrphans(readRows(liveFile), nowMs, ttlMs);
    if (orphans.length === 0) return 0;

    const ts = new Date(nowMs).toISOString();
    for (const spawn of orphans) {
      // Usage figures stay null and accuracy stays 'unattributed': nothing was measured
      // here. A zero would read as "this agent cost nothing", which is a different claim.
      appendJsonl(liveFile, JSON.stringify({
        ts,
        event: 'stop',
        session_id: spawn.session_id || null,
        subagent_id: spawn.subagent_id,
        name: spawn.name || 'unknown',
        duration_ms: null,
        tokens_in: null,
        tokens_out: null,
        cost_usd: null,
        status: 'orphaned',
        accuracy: 'unattributed',
        reaped: true
      }) + '\n');
    }
    return orphans.length;
  } catch {
    return 0; // fail-open — a reaper failure must never affect the caller
  }
}

module.exports = { reapOrphanedSubagents, findOrphans, SUBAGENT_STALE_TTL_MS };
