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

/**
 * The workflow the `cumulativeCostUsd` tally in state belongs to.
 *
 * The tally used to be scoped by comparing `state.workflowId` against the resolved id, on
 * the assumption that subagent-cost-capture was the only writer of `workflowId`. It is not:
 * the conductor now writes `workflowId` itself when it starts a feature (X-Game-Pro, 0.12.1:
 * an Edit of .workflow-state.json setting `"workflowId": "bk-code:session-api"`), so by the
 * time a subagent stopped the ids already matched and the reset never fired. The tally ran
 * across features to $441.07 while the current workflow's own ledger rows summed to ~$18,
 * and budget-guard injected "BUDGET EXCEEDED: 1574%" ~30 times a session.
 *
 * So the tally carries its own owner key, written only by subagent-cost-capture, next to the
 * figure it describes. Nothing else writes it, so nothing else can make it lie.
 */
const COST_OWNER_KEY = 'cumulativeCostWorkflowId';

/**
 * `state.cumulativeCostUsd`, but only when it is the tally of `workflowId`.
 *
 * Returns null for a tally owned by another workflow and for one with no owner at all —
 * the second case is every state written before the owner key existed, including the field
 * state holding $441 of earlier features. Treating it as unknown rather than as this
 * workflow's is the migration: readers fall back to the ledger, which is filtered by
 * workflowId, and the next subagent stop replaces the tally with an owned one.
 *
 * @param {object|null|undefined} state - workflow state
 * @param {string} workflowId - resolveWorkflowId() for the current workflow
 * @returns {number|null}
 */
function ownedCumulativeCost(state, workflowId) {
  if (!state || typeof state !== 'object') return null;
  const cost = state.cumulativeCostUsd;
  if (typeof cost !== 'number' || !isFinite(cost)) return null;
  if (!workflowId || state[COST_OWNER_KEY] !== workflowId) return null;
  return cost;
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

module.exports = { resolveWorkflowId, ownedCumulativeCost, COST_OWNER_KEY };
