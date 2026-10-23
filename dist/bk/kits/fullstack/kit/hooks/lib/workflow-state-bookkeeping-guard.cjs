/**
 * workflow-state-bookkeeping-guard.cjs — Keep the conductor's hands off fsm-guard's own fields.
 *
 * `phase_history`, `phase_recurrence_count` and `recurrence_reset_ts` are what the recurrence
 * ladder decides on, and fsm-guard is their only legitimate writer. Nothing enforced that. In
 * X-Game-Pro (0.12.2, /bk-code quick-session-create batch 2 of 3) the conductor, stuck in a
 * review-fix loop, hand-edited .workflow-state.json to "close B2 without re-review": it appended
 * `testing` and `review` entries with invented timestamps to phase_history and bumped the counts
 * to testing:2 review:2. The FSM then (correctly) refused coding→review, the fabricated entries
 * tipped coding→testing into a recurrence block, and the workflow ended in a HARD BLOCK that no
 * printed remedy could lift. A ladder the conductor can rewrite measures nothing.
 *
 * So fsm-guard now reviews every Write/Edit of the state file against the file on disk:
 *   - phase_history must come back unchanged (or be absent — a minimal Write);
 *   - phase_recurrence_count must come back unchanged, absent, or reset to {} — the documented
 *     batch-boundary write, normally together with `batch: N+1`;
 *   - recurrence_reset_ts must come back unchanged or absent.
 * Anything else is denied. Absent fields are restored after the write, so a Write that drops
 * them cannot erase the ladder either.
 *
 * A write that opens a NEW episode is not reviewed here: the new-episode reset overwrites all
 * of these fields after the write, whatever the write carried.
 *
 * An Edit is judged by the whole document it would produce — its replacement applied to the
 * file as it is on disk — not by the fragment in new_string. A fragment cannot tell appending
 * an entry from quoting an existing one; the resulting document can.
 */

'use strict';

/** The fields only fsm-guard writes. */
const HOOK_OWNED_FIELDS = ['phase_history', 'phase_recurrence_count', 'recurrence_reset_ts'];

/**
 * JSON with object keys sorted, so two equal values compare equal however the conductor
 * happened to order or indent them.
 * @param {*} value
 * @returns {string}
 */
function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort()
      .map((k) => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
  }
  return JSON.stringify(value === undefined ? null : value);
}

/**
 * The whole state document a Write or Edit would leave on disk, or null when that cannot be
 * known (content that is not JSON, an old_string the file does not contain — the Edit tool
 * refuses that one itself). Null means "cannot judge", and the caller lets the write through.
 *
 * @param {object} toolInput - Write: { content }; Edit: { old_string, new_string, replace_all }
 * @param {string|null} rawDisk - the state file's current bytes
 * @returns {object|null}
 */
function proposedState(toolInput, rawDisk) {
  const ti = toolInput || {};
  let text = null;
  if (typeof ti.content === 'string') {
    text = ti.content;
  } else if (typeof ti.old_string === 'string' && typeof ti.new_string === 'string' &&
             typeof rawDisk === 'string' && ti.old_string && rawDisk.includes(ti.old_string)) {
    if (ti.replace_all) {
      text = rawDisk.split(ti.old_string).join(ti.new_string);
    } else {
      // indexOf + slice, not String.replace: new_string may contain `$&`-style patterns.
      const i = rawDisk.indexOf(ti.old_string);
      text = rawDisk.slice(0, i) + ti.new_string + rawDisk.slice(i + ti.old_string.length);
    }
  }
  if (text === null) return null;
  try {
    const parsed = JSON.parse(text);
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Review a write's hook-owned fields against the state on disk.
 *
 * @param {object} before - state on disk
 * @param {object} after - proposedState() of the write
 * @returns {{deny: string|null, countsReset: boolean, batchAdvanced: boolean, restore: object}}
 *   deny: the field that was tampered with, else null.
 *   countsReset: the write resets phase_recurrence_count to {} from a non-empty value.
 *   batchAdvanced: the write's `batch` is greater than the one on disk.
 *   restore: hook-owned fields the write dropped, with their on-disk values.
 */
function reviewBookkeepingWrite(before, after) {
  const result = { deny: null, countsReset: false, batchAdvanced: false, restore: {} };
  const b = before || {};
  const a = after || {};

  // `null` is treated as absent: both mean "this write does not carry the field".
  const carries = (field) => field in a && a[field] !== null;
  for (const field of HOOK_OWNED_FIELDS) {
    if (!carries(field) && field in b && b[field] !== null) result.restore[field] = b[field];
  }

  if (carries('phase_history')) {
    const was = Array.isArray(b.phase_history) ? b.phase_history : [];
    if (canonicalJson(a.phase_history) !== canonicalJson(was)) {
      result.deny = 'phase_history';
      return result;
    }
  }

  if (carries('phase_recurrence_count')) {
    const was = (b.phase_recurrence_count && typeof b.phase_recurrence_count === 'object')
      ? b.phase_recurrence_count : {};
    const now = a.phase_recurrence_count;
    const isEmptyObject = now && typeof now === 'object' && !Array.isArray(now) &&
      Object.keys(now).length === 0;
    if (isEmptyObject) {
      result.countsReset = Object.keys(was).length > 0;
    } else if (canonicalJson(now) !== canonicalJson(was)) {
      result.deny = 'phase_recurrence_count';
      return result;
    }
  }

  if (carries('recurrence_reset_ts')) {
    const was = b.recurrence_reset_ts === undefined ? null : b.recurrence_reset_ts;
    if (a.recurrence_reset_ts !== was) {
      result.deny = 'recurrence_reset_ts';
      return result;
    }
  }

  const batchBefore = Number(b.batch);
  const batchAfter = Number(a.batch);
  result.batchAdvanced = Number.isFinite(batchBefore) && Number.isFinite(batchAfter) &&
    batchAfter > batchBefore;
  return result;
}

/**
 * The deny reason for a tampering write. It has to say what to do instead, or the conductor
 * just tries the next way around.
 *
 * @param {string} field
 * @returns {string}
 */
function bookkeepingDenyMessage(field) {
  return (
    `FSM BOOKKEEPING — "${field}" in .workflow-state.json is recorded by fsm-guard, not by you. ` +
    `This write was refused.\n` +
    `To move the workflow, change only current_phase (plus your own fields such as batch or ` +
    `quality_fix_count): the hook appends the phase_history entry and the count itself once ` +
    `your write lands. Copy phase_history / phase_recurrence_count unchanged, or leave them out.\n` +
    `The one count write that is yours: at a COMPLETED batch, write batch: N+1 together with ` +
    `phase_recurrence_count: {} (current_phase unchanged).\n` +
    `If the recurrence ladder is blocking you, do not edit around it — follow the block ` +
    `message and ask the user (AskUserQuestion).`
  );
}

module.exports = {
  HOOK_OWNED_FIELDS, canonicalJson, proposedState, reviewBookkeepingWrite, bookkeepingDenyMessage
};
