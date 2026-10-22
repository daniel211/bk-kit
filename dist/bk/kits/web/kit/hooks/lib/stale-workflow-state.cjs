/**
 * stale-workflow-state.cjs — is the workflow state a leftover of an EARLIER session?
 *
 * .workflow-state.json outlives sessions, and post-commit.cjs pins current_phase at "commit"
 * after a feature lands. A later ad-hoc session (no /bk-* skill) therefore reads a finished
 * feature's state, and everything keyed off it — the agent-trace row, the cost-ledger
 * workflowId, the budget tally — gets charged to that feature (X-Game-Pro, kit 0.13.5: new
 * ad-hoc agents attributed to the previous, long-committed feature).
 *
 * Signal: the phase_history entry that put the workflow into its current terminal phase carries
 * `entered_by` — the session id fsm-guard recorded. If that is a real session id and differs
 * from the session now stopping, nobody in this session drove the workflow there and the state
 * is stale. We deliberately do NOT use updated_at: every state write (subagent-cost-capture
 * bumps it on each stop) refreshes it, so it says "touched" about a state nobody worked on.
 *
 * Conservative by construction: anything missing or ambiguous (no session id, non-terminal
 * phase, no matching history entry, placeholder entered_by) returns false, i.e. the old
 * behaviour — attribute to the state as before. Never throws.
 */

'use strict';

const TERMINAL_PHASES = ['commit', 'escalated', 'completed'];

/** entered_by values that are not a session id (fsm-guard / bk-health fallbacks). */
const PLACEHOLDER_ENTERED_BY = ['', 'unknown', 'bk-health-cli'];

/**
 * @param {object|null|undefined} state - workflow state
 * @param {string|null|undefined} sessionId - session of the hook now running
 * @returns {boolean} true only when there is positive evidence the terminal state belongs to another session
 */
function isStaleTerminalState(state, sessionId) {
  try {
    if (!state || typeof state !== 'object') return false;
    const sid = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (!sid) return false;
    const phase = state.current_phase;
    if (!TERMINAL_PHASES.includes(phase)) return false;
    const history = Array.isArray(state.phase_history) ? state.phase_history : [];
    for (let i = history.length - 1; i >= 0; i--) {
      const h = history[i];
      if (!h || h.phase !== phase) continue;
      const by = typeof h.entered_by === 'string' ? h.entered_by.trim() : '';
      if (PLACEHOLDER_ENTERED_BY.includes(by)) return false;
      return by !== sid;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * The state a hook should attribute work to: `{}` (ad-hoc) when the terminal state is stale for
 * this session, otherwise the state unchanged.
 */
function liveStateFor(state, sessionId) {
  return isStaleTerminalState(state, sessionId) ? {} : state;
}

module.exports = { isStaleTerminalState, liveStateFor, TERMINAL_PHASES };
