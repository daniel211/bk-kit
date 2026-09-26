/**
 * phase-recurrence-window.cjs — Which `phase_history` entries the recurrence ladder counts.
 *
 * fsm-guard decides warn / block / halt from two numbers: `phase_recurrence_count[phase]` and
 * how often the phase appears in the last few `phase_history` entries. The count was reset at
 * every batch boundary (by the conductor) and by `bk-health --reset-counts`; the history never
 * was. So the two disagreed, and the window alone kept the ladder armed after every reset.
 *
 * Field case (X-Game-Pro, 0.12.2, /bk-code quick-session-create batch 2 of 3): counts had been
 * reset to {} at the B1→B2 boundary, yet the window still held batch 1's entries, and after
 * `--resume` + `--reset-counts --force` the guard still said "HARD BLOCK — testing entered 1
 * times": the count said 1, the window said 4, and the message printed the number that had
 * NOT decided. No printed remedy could lift it, because none of them touched what the window
 * reads.
 *
 * The fix is one timestamp, `recurrence_reset_ts`, written with every reset of the count:
 *   - by fsm-guard itself when the conductor's batch-boundary write (`batch: N+1` +
 *     `phase_recurrence_count: {}`) lands — see workflow-state-bookkeeping-guard.cjs;
 *   - by `bk-health --resume` (after a recurrence pause) and `bk-health --reset-counts`.
 * The window then counts only entries recorded after it. Stamping a batch number on each
 * entry was the alternative, but the CLI remedies are not batch changes and bk-debug /
 * bk-refactor have no batches at all; one reset instant covers every case with one rule.
 *
 * Legacy entries (no numeric `ts`) predate every reset, so they count only while no reset has
 * ever been recorded — exactly the behaviour they had before. Entries dated in the future
 * cannot have been written by the hook (it stamps `Date.now()`), only by hand, so they never
 * count: a fabricated entry with an invented timestamp must not be able to outlive a reset.
 */

'use strict';

/** How many recent counted entries the window looks at (the incoming transition is +1). */
const RECURRENCE_WINDOW_SIZE = 5;

/**
 * Entries of `state.phase_history` that the recurrence ladder may count.
 *
 * Pure and total: garbage in → [] out. Shapes that are not fsm-guard's own
 * (`{ phase, ts, ... }`) — post-commit's `{ from, to, timestamp }` rows — are dropped.
 *
 * @param {object|null|undefined} state - workflow state
 * @param {number} [now]
 * @returns {Array<{phase: string, ts?: number}>}
 */
function countedHistory(state, now = Date.now()) {
  const s = (state && typeof state === 'object') ? state : {};
  const history = Array.isArray(s.phase_history) ? s.phase_history : [];
  const resetTs = typeof s.recurrence_reset_ts === 'number' ? s.recurrence_reset_ts : null;
  return history.filter((e) => {
    if (!e || typeof e !== 'object' || typeof e.phase !== 'string') return false;
    const ts = typeof e.ts === 'number' ? e.ts : null;
    if (ts !== null && ts > now) return false;          // future-dated: hand-written
    if (resetTs === null) return true;                   // no reset ever: legacy behaviour
    return ts !== null && ts > resetTs;                  // only what came after the reset
  });
}

/**
 * How many times `phase` would have been entered within the window, counting the incoming
 * transition. This is the window half of the ladder's decision.
 *
 * @param {object} state
 * @param {string} phase
 * @param {number} [now]
 * @returns {number}
 */
function windowEntryCount(state, phase, now = Date.now()) {
  const window = countedHistory(state, now).slice(-RECURRENCE_WINDOW_SIZE);
  return window.filter((e) => e.phase === phase).length + 1;
}

/**
 * The fields a reset of the recurrence ladder writes: the count AND the window start.
 * Every reset path uses this, so a reset can never again clear one half of the decision.
 *
 * @param {number} [now]
 * @returns {{phase_recurrence_count: object, recurrence_reset_ts: number}}
 */
function recurrenceResetFields(now = Date.now()) {
  return { phase_recurrence_count: {}, recurrence_reset_ts: now };
}

module.exports = { RECURRENCE_WINDOW_SIZE, countedHistory, windowEntryCount, recurrenceResetFields };
