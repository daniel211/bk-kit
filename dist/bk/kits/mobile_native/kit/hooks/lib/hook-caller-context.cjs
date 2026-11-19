/**
 * hook-caller-context.cjs — did this tool event come from a subagent or from the main session?
 *
 * PreToolUse and PostToolUse fire for a subagent's tool calls as well as the conductor's, with
 * the same session_id. Anything that must speak only to the conductor — conductor-inbox-drain —
 * or must not blame the conductor for a subagent's write — anti-self-implementation — has to
 * tell the two apart from the payload.
 *
 * The signal, verified in the field rather than assumed: fusionworkomni's hook-log.jsonl holds
 * 19 anti-self-implementation rows for 2026-09-22/23. The 2 main-session Edits in its
 * transcripts (isSidechain false, .plan-state.json at 08:13:04.674 and 08:13:12.756) map to the
 * only 2 `allowed` rows, 80ms later; the other 17 — all subagent writes — are
 * `agent_passthrough`, which that hook returns only when the payload carries `agent_type` or
 * `agent_id`, or a transcript under `<session>/subagents/`. X-Game-Pro agrees: 50 of 50 rows
 * `agent_passthrough`, with no main-session Write/Edit in that log's window.
 */

'use strict';

/**
 * @param {object} data — parsed hook stdin
 * @returns {boolean} true when the event belongs to a subagent
 */
function isSubagentEvent(data) {
  if (!data || typeof data !== 'object') return false;
  if (data.agent_type || data.agent_id) return true;
  const transcript = String(data.agent_transcript_path || data.transcript_path || '').replace(/\\/g, '/');
  return transcript.includes('/subagents/');
}

module.exports = { isSubagentEvent };
