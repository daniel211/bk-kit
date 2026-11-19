/**
 * subagent-stop-identity.cjs — one answer to "is this SubagentStop a subagent finishing,
 * and which subagent?", shared by every hook on that event.
 *
 * Three hooks read SubagentStop — subagent-live-tracker, workflow-metrics and
 * subagent-cost-capture — and each used to decide for itself. They disagreed, and the field
 * showed exactly how much: for one run of work the live log recorded 7 completions, the agent
 * trace 8, and the cost ledger 54. Only one of those numbers was right.
 *
 * Two facts from the field, both measured:
 *
 *  1. Most SubagentStop events are not a completion. One session: 4 dispatches, 50 events,
 *     3 carrying `agent_type` and an agent transcript with real usage — the 3 dispatches that
 *     had finished. The other 47 named nobody and reported no usage. `agent_type` is the
 *     signal; `agent_id` alone is not, because it is on every event including those 47.
 *
 *  2. A completion can be reported more than once. `duplicate_stop` fired for a
 *     bk-project-manager run whose second event read a longer transcript than the first, so
 *     the hooks without de-duplication counted it twice and the ledger billed it twice.
 *
 * For an event that names an agent, `agent_id` is the agent's transcript id — `agent_id`
 * "a83e00b1efa569301" alongside `agent_transcript_path` ".../agent-a83e00b1efa569301.jsonl".
 * Either identifies the subagent; the transcript basename is used because it is also what
 * carries the usage, so a record that has one has the other.
 */

'use strict';

const path = require('path');

/**
 * @returns {{ id: string|null, eventId: string|null, name: string|null, transcript: string|null }}
 *   `id` is stable for the subagent's life. `eventId` is the raw agent_id, recorded for
 *   diagnostics. `name` being null means this event is not a completion.
 */
function readStopIdentity(hookData) {
  const data = hookData || {};
  const transcript = data.agent_transcript_path || data.agentTranscriptPath || null;
  const name = data.agent_type || data.agent_name || data.agentName || data.subagent_name || null;
  const eventId = data.agent_id || data.agentId || null;
  return {
    id: transcript ? path.basename(String(transcript)) : (name ? eventId : null),
    eventId,
    name,
    transcript
  };
}

/**
 * Does this event mark a subagent finishing? Everything else is ignored by every hook.
 */
function isCompletion(identity) {
  return Boolean(identity && identity.name);
}

/**
 * Has this subagent already been recorded in `rows`?
 *
 * First record wins, which slightly undercounts a subagent whose later event read a longer
 * transcript. That is the safe direction: a missing repeat costs a little accuracy, a counted
 * one inflates every total built on it.
 *
 * @param {Iterable<object>} rows — records already written by the calling hook
 * @param {string} field — the property those records store the stable id in
 * @param {string|null} stableId
 * @param {string|null} sessionId — when both sides carry one, they must match
 */
function alreadyRecorded(rows, field, stableId, sessionId) {
  if (!stableId) return false;
  for (const row of rows) {
    if (!row || row[field] !== stableId) continue;
    const rowSession = row.session_id || row.sessionId;
    if (sessionId && rowSession && rowSession !== sessionId) continue;
    return true;
  }
  return false;
}

/**
 * Read a JSONL file into parsed records, skipping anything unparseable. Returns [] when the
 * file does not exist yet, so a first run reads as "nothing recorded".
 */
function readJsonlRows(filePath) {
  let text;
  try { text = require('fs').readFileSync(filePath, 'utf8'); }
  catch { return []; }
  const rows = [];
  for (const line of text.split('\n')) {
    const raw = line.trim();
    if (!raw) continue;
    try { rows.push(JSON.parse(raw)); } catch { /* skip */ }
  }
  return rows;
}

module.exports = { readStopIdentity, isCompletion, alreadyRecorded, readJsonlRows };
