/**
 * injection-budget-state.cjs — the per-session counters behind the hook injection budget.
 *
 * Split out of injection-budget.cjs (CLAUDE.md §Modularization). This file owns the tmpdir
 * file, the turn boundary and the hash ledger; injection-budget.cjs owns the decision.
 *
 * The state file is `<tmpdir>/bk-injection-<sessionId>.json`, the same shape of scratch state
 * prompt-context-inject.cjs and token-burn-detector.cjs already keep:
 *
 *   { v, turnKey, turnSeq, spentBytes, updatedAt, entries: { <contentHash>: <turnSeq> } }
 *
 * Nothing here throws. A missing, corrupt or stale file resolves to a fresh state, because an
 * unreadable budget must never be the reason a safety warning went unsaid.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { DEFAULTS } = require('./injection-budget-config.cjs');

/**
 * Session id from a hook payload. Payload only, never env: a hook invoked without a session id
 * gets no budget at all rather than sharing one bucket with unrelated sessions.
 * @param {object} payload — parsed hook stdin
 * @returns {string|null}
 */
function sessionIdFrom(payload) {
  try {
    if (!payload || typeof payload !== 'object') return null;
    const id = payload.session_id || payload.sessionId || null;
    return id ? String(id) : null;
  } catch {
    return null;
  }
}

/**
 * Where this session's counters live.
 * @param {string} sessionId
 * @returns {string}
 */
function statePath(sessionId) {
  const dir = process.env.BK_INJECTION_STATE_DIR || os.tmpdir();
  const safe = String(sessionId).replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 80);
  return path.join(dir, `bk-injection-${safe}.json`);
}

/**
 * The turn this call belongs to.
 * No hook event carries a turn id, so a time slice stands in unless the caller supplies one
 * (tests do, and any future event that grows a turn field can too).
 * @returns {string}
 */
function resolveTurnKey(opts, cfg, now) {
  if (opts && opts.turnId != null && opts.turnId !== '') return String(opts.turnId);
  const window = cfg.turnWindowMs > 0 ? cfg.turnWindowMs : DEFAULTS.turnWindowMs;
  return `t${Math.floor(now / window)}`;
}

/** Empty state, used for a fresh session and for anything unreadable. */
function freshState(turnKey) {
  return { v: 1, turnKey, turnSeq: 1, spentBytes: 0, updatedAt: 0, entries: {}, rolled: true };
}

/**
 * Read this session's state and roll it forward to the current turn.
 *
 * A new turn resets `spentBytes` and bumps `turnSeq`, which is what the dedupe window counts
 * in. Corrupt, missing and stale files all resolve to a fresh state.
 *
 * `rolled` is set when the returned state differs from what is on disk. The caller must then
 * persist it even if it injects nothing: turns in which every hook was suppressed still have
 * to advance `turnSeq`, or the dedupe window never elapses and the text is silenced forever.
 *
 * @param {string} sessionId
 * @param {object} cfg — from loadInjectionConfig()
 * @param {number} now — epoch ms
 * @param {string} turnKey — from resolveTurnKey()
 * @returns {{v:number, turnKey:string, turnSeq:number, spentBytes:number, updatedAt:number, entries:object}}
 */
function readState(sessionId, cfg, now, turnKey) {
  let state = null;
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath(sessionId), 'utf8'));
    if (parsed && typeof parsed === 'object' && typeof parsed.turnSeq === 'number') {
      state = {
        v: 1,
        turnKey: typeof parsed.turnKey === 'string' ? parsed.turnKey : turnKey,
        turnSeq: parsed.turnSeq,
        spentBytes: typeof parsed.spentBytes === 'number' ? parsed.spentBytes : 0,
        updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
        entries: (parsed.entries && typeof parsed.entries === 'object') ? parsed.entries : {}
      };
    }
  } catch { /* missing or corrupt → fresh */ }

  if (!state) return freshState(turnKey);
  if (cfg.stateTtlMs > 0 && now - state.updatedAt > cfg.stateTtlMs) return freshState(turnKey);

  if (state.turnKey !== turnKey) {
    state.turnKey = turnKey;
    state.turnSeq += 1;
    state.spentBytes = 0;
    state.rolled = true;
  }
  return state;
}

/**
 * Best-effort write. A failed write only means the next call sees an older turn.
 * Serialises the known fields, so bookkeeping like `rolled` never lands on disk.
 */
function writeState(sessionId, state) {
  try {
    fs.writeFileSync(statePath(sessionId), JSON.stringify({
      v: 1,
      turnKey: state.turnKey,
      turnSeq: state.turnSeq,
      spentBytes: state.spentBytes,
      updatedAt: state.updatedAt,
      entries: state.entries || {}
    }));
  } catch { /* ignore */ }
}

/**
 * Drop the oldest hashes once the ledger outgrows `maxEntries`.
 * Oldest = lowest turnSeq, i.e. the ones closest to leaving the dedupe window anyway.
 */
function pruneEntries(entries, cfg) {
  const keys = Object.keys(entries);
  if (keys.length <= cfg.maxEntries) return entries;
  const kept = keys
    .sort((a, b) => (entries[b] || 0) - (entries[a] || 0))
    .slice(0, cfg.maxEntries);
  const out = {};
  for (const k of kept) out[k] = entries[k];
  return out;
}

module.exports = {
  sessionIdFrom,
  statePath,
  resolveTurnKey,
  freshState,
  readState,
  writeState,
  pruneEntries
};
