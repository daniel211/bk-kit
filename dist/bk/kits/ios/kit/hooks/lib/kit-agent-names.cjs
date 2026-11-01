'use strict';
/**
 * kit-agent-names.cjs — is this subagent one of the kit's own?
 *
 * SubagentStop fires for every subagent in the session: Claude Code's built-ins
 * (statusline-setup, Explore, general-purpose, …) and agents other plugins ship, not just
 * bk agents. Field review 2026-11-01 found them attributed to whichever bk workflow was
 * open — a `statusline-setup` run wrote its own workflow-summary row for
 * `bk-code:cancel-session-backend`, and design-agy-extractor / design-spec-writer /
 * design-asset-exporter landed in cost-ledger.jsonl under bk workflows.
 *
 * The two consumers want different things, which is why this module only answers the
 * question and does not act on it:
 *   - workflow-metrics drops a foreign agent outright: it is not part of the workflow, so
 *     counting it corrupts total_agents and lets it emit a summary of its own.
 *   - subagent-cost-capture keeps the row and tags it: the money was really spent, and
 *     budget-guard must still see it. Only the per-agent attribution is wrong.
 *
 * The kit names all of its agents `bk-*`. A project that renames them lists the extra
 * prefixes in BK_WORKFLOW_AGENT_PREFIXES (comma-separated) rather than lose tracking.
 */

const DEFAULT_PREFIXES = 'bk-';

/** @returns {string[]} */
function kitAgentPrefixes() {
  return (process.env.BK_WORKFLOW_AGENT_PREFIXES || DEFAULT_PREFIXES)
    .split(',').map((x) => x.trim()).filter(Boolean);
}

/**
 * @param {unknown} name — the agent name from readStopIdentity()
 * @returns {boolean} true when the name belongs to the kit
 */
function isKitAgent(name) {
  if (typeof name !== 'string' || name === '') return false;
  return kitAgentPrefixes().some((prefix) => name.startsWith(prefix));
}

module.exports = { isKitAgent, kitAgentPrefixes, DEFAULT_PREFIXES };
