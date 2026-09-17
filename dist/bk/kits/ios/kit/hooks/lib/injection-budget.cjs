/**
 * injection-budget.cjs — one place that decides how much hook text reaches the model.
 *
 * Why this file exists: 18 of the kit's hooks emit `additionalContext`, and nothing ever
 * looked at the total. Measured worst case was ~38 KB (~9.5k tokens) if every block fired in
 * one turn, and the same warning text was re-injected verbatim on every tool call that
 * tripped it — a PreToolUse advisory on Task fires once per dispatch, so a 10-dispatch batch
 * paid for the same 1.5 KB ten times.
 *
 * The pattern is lifted from hooks/prompt-context-inject.cjs, which already solved this for
 * one hook: a counter file in os.tmpdir() keyed by session, consulted before speaking. This
 * generalises it to three limits (defaults, all tunable — see injection-budget-config.cjs):
 *
 *   per-block   1536 B — any single injection, truncated at a line boundary past that
 *   per-turn    4096 B — everything all hooks inject inside one turn
 *   dedupe      10 turns — the same content hash stays quiet for that long
 *
 * FAIL-OPEN IS THE CONTRACT. A dropped safety warning costs more than a few hundred wasted
 * tokens, so every path that cannot reach a confident "no" returns "yes": unreadable state,
 * corrupt JSON, missing session id, an exception anywhere — the text goes out.
 *
 * BLOCKING DECISIONS ARE NOT BUDGETED. `permissionDecision: "deny"`, exit-2 reasons and
 * anything else that stops a tool call must not be routed through here. Where a hook shares
 * one emit path between advisory and blocking output, pass `exempt: true` for the block.
 *
 * Companions (split per CLAUDE.md §Modularization):
 *   injection-budget-config.cjs — defaults, config file, env overrides
 *   injection-budget-state.cjs  — the tmpdir counters, turn boundary, hash ledger
 *   injection-budget-text.cjs   — hashing and line-boundary truncation
 *
 * Exports:
 *   shouldInject(hookName, contentHash, opts)           — may this block be injected?
 *   recordInjection(hookName, bytes, contentHash, opts) — charge it against the turn
 *   truncateToBudget(text, maxBytes, opts)              — trim at a line boundary + pointer
 *   prepareInjection(hookName, text, opts)              — the one call hooks actually make
 *   hashContent / sessionIdFrom / loadInjectionConfig / statePath
 */

'use strict';

const {
  DEFAULTS, DEFAULT_POINTER, num, loadInjectionConfig, resetConfigCache
} = require('./injection-budget-config.cjs');
const {
  sessionIdFrom, statePath, resolveTurnKey, readState, writeState, pruneEntries
} = require('./injection-budget-state.cjs');
/** @typedef {ReturnType<typeof readState>} BudgetState */
const { hashContent, truncateToBudget } = require('./injection-budget-text.cjs');

/**
 * May this block be injected?
 *
 * False only when the budget is confident: identical content inside the dedupe window, or the
 * turn's byte budget already spent. Everything else — no session id, no state, an exception —
 * is true.
 *
 * @param {string} hookName — for callers' logs; the budget is global, not per hook
 * @param {string} contentHash — from hashContent(), over the exact text to be injected
 * @param {{sessionId?: string|null, bytes?: number, now?: number, turnId?: string|number,
 *          exempt?: boolean, config?: object}} [opts]
 * @returns {boolean}
 */
function shouldInject(hookName, contentHash, opts) {
  try {
    const o = opts || {};
    if (o.exempt) return true;

    const cfg = loadInjectionConfig(o.config);
    if (!cfg.enabled) return true;

    const sessionId = o.sessionId;
    if (!sessionId) return true; // no session → no state → never suppress

    const now = typeof o.now === 'number' ? o.now : Date.now();
    const turnKey = resolveTurnKey(o, cfg, now);
    const state = readState(sessionId, cfg, now, turnKey);

    // A turn in which every hook was suppressed still has to be recorded, or turnSeq never
    // moves and the dedupe window never elapses.
    if (state.rolled) {
      state.updatedAt = now;
      writeState(sessionId, state);
    }

    const bytes = num(o.bytes) || 0;
    if (cfg.perTurnMaxBytes > 0 && state.spentBytes + bytes > cfg.perTurnMaxBytes) {
      // One oversized block on an untouched turn still gets through: silence is worse than
      // overspending once, and prepareInjection has already capped it at perBlockMaxBytes.
      if (state.spentBytes > 0) return false;
    }

    const lastSeq = state.entries ? state.entries[contentHash] : undefined;
    if (typeof lastSeq === 'number' && (state.turnSeq - lastSeq) < cfg.dedupeTurns) return false;

    return true;
  } catch {
    return true; // fail-open
  }
}

/**
 * Charge an injection against the current turn and remember its hash.
 * Best-effort: a failed write only loosens the budget.
 *
 * @param {string} hookName
 * @param {number} bytes
 * @param {string} contentHash
 * @param {{sessionId?: string|null, now?: number, turnId?: string|number, config?: object}} [opts]
 * @returns {void}
 */
function recordInjection(hookName, bytes, contentHash, opts) {
  try {
    const o = opts || {};
    const cfg = loadInjectionConfig(o.config);
    if (!cfg.enabled) return;
    const sessionId = o.sessionId;
    if (!sessionId) return;

    const now = typeof o.now === 'number' ? o.now : Date.now();
    const turnKey = resolveTurnKey(o, cfg, now);
    const state = readState(sessionId, cfg, now, turnKey);

    state.spentBytes += num(bytes) || 0;
    state.updatedAt = now;
    if (contentHash) {
      state.entries[contentHash] = state.turnSeq;
      state.entries = pruneEntries(state.entries, cfg);
    }
    writeState(sessionId, state);
  } catch { /* ignore */ }
}

/**
 * The call hooks make: cap the block, ask the budget, charge it.
 *
 * @param {string} hookName
 * @param {string} text — the additionalContext this hook wants to emit
 * @param {{sessionId?: string|null, now?: number, turnId?: string|number, exempt?: boolean,
 *          maxBytes?: number, pointer?: string, config?: object}} [opts]
 * @returns {string|null} text to emit (possibly trimmed), or null to stay silent
 */
function prepareInjection(hookName, text, opts) {
  try {
    const str = String(text == null ? '' : text);
    if (!str.trim()) return null;

    const o = opts || {};
    const cfg = loadInjectionConfig(o.config);
    if (!cfg.enabled || o.exempt) return str;

    const maxBytes = num(o.maxBytes) !== undefined ? o.maxBytes : cfg.perBlockMaxBytes;
    const capped = truncateToBudget(str, maxBytes, { pointer: o.pointer });
    const bytes = Buffer.byteLength(capped, 'utf8');
    const hash = hashContent(capped);

    if (!shouldInject(hookName, hash, { ...o, bytes })) return null;
    recordInjection(hookName, bytes, hash, o);
    return capped;
  } catch {
    // Never swallow a warning because the budget itself broke.
    return String(text == null ? '' : text);
  }
}

module.exports = {
  DEFAULTS,
  DEFAULT_POINTER,
  loadInjectionConfig,
  resetConfigCache,
  hashContent,
  sessionIdFrom,
  statePath,
  truncateToBudget,
  shouldInject,
  recordInjection,
  prepareInjection
};
