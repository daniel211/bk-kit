/**
 * workflow-identity.cjs — the one place that decides what "this workflow" means.
 *
 * The cost ledger is written by subagent-cost-capture and read back by budget-guard.
 * They used to derive the workflow key independently: the writer stamped
 * `state.workflowId || sessionId`, the reader looked for `state.workflowId`, which
 * nothing ever wrote. The reader's filter therefore never matched, and it summed every
 * subagent entry ever written, across every session — a budget that only ever went up.
 *
 * Both sides now call resolveWorkflowId(). The key is derived from the workflow itself
 * (command + feature), not the session id, so a resumed or compacted session keeps the
 * same tally and a new command starts a fresh one.
 */

'use strict';

/**
 * Stable identity for the workflow described by a workflow-state object.
 *
 * Pure and total: never throws, never reads the filesystem, and returns a usable string
 * for null/undefined/garbage input (hooks call this on fail-open paths).
 *
 * @param {object|null|undefined} state - workflow state (.workflow-state.json contents)
 * @param {string|null} [sessionId] - fallback scope when the workflow has no feature yet
 * @returns {string} e.g. "bk-code:checkout-flow", "session:abc123", "session:unscoped"
 */
function resolveWorkflowId(state, sessionId) {
  const s = (state && typeof state === 'object') ? state : {};
  const command = normalize(s.command) || 'session';
  const feature = normalize(s.feature) || normalize(sessionId) || 'unscoped';
  return `${command}:${feature}`;
}

/** Coerce a state field to a trimmed non-empty string, or '' — never throws. */
function normalize(value) {
  if (typeof value !== 'string') return '';
  try {
    return value.trim();
  } catch {
    return '';
  }
}

module.exports = { resolveWorkflowId };
