/**
 * subagent-transcript-diagnostics.cjs - WHY a subagent's final message came back empty.
 *
 * Field review 2026-10-16: 45 of 341 X-Game-Pro traces were `no_output` and nothing recorded the
 * cause. This scans a subagent transcript (agent_transcript_path) and returns a `reason` code
 * plus cheap structural counters. It reads shape only — block TYPES, tool NAMES, sizes — and
 * never copies prompt or response content out of the transcript.
 *
 * Reason codes (the `reason` of a `no_output` trace row):
 *   transcript_path_missing    payload carried no agent_transcript_path
 *   transcript_unreadable      path given but stat/read failed (not flushed yet, or deleted)
 *   transcript_empty           file exists with 0 bytes (SubagentStop fired before the flush)
 *   transcript_parse_error     non-empty, but no line parsed as JSON
 *   no_assistant_turn          parsed, but contains no assistant entry
 *   empty_last_assistant_message  last assistant turn has text block(s), all blank
 *   only_tool_use_in_last_turn last assistant turn ends on a tool call (not SubagentHandback)
 *   empty_handback_message     last turn is SubagentHandback whose message is blank
 *   no_final_text_block        last turn has neither text nor tool_use (e.g. thinking only)
 *
 * Not a no_output reason: `transcript_final_text` — the payload's last_assistant_message was
 * empty but the transcript's last turn is plain text with no tool call. The caller then uses
 * that text, so the row is classified instead of filed as silent.
 */

'use strict';

const fs = require('fs');

const HANDBACK_TOOL = 'SubagentHandback';
/** Above this the whole file is not read for counting; counters then come from the tail only. */
const MAX_FULL_READ_BYTES = 8 * 1024 * 1024;

function emptyDiagnostics() {
  return { transcript_bytes: null, assistant_turns: null, last_stop_reason: null, last_block_type: null, last_tool: null };
}

/**
 * @param {string|undefined} transcriptPath
 * @returns {{ reason: string, diagnostics: object, lastTurnText: string }}
 *   lastTurnText is the non-blank text of the last assistant turn ('' when none) — used by the
 *   caller as a fallback source, never stored.
 */
function diagnoseTranscript(transcriptPath) {
  const diagnostics = emptyDiagnostics();
  if (!transcriptPath || typeof transcriptPath !== 'string') {
    return { reason: 'transcript_path_missing', diagnostics, lastTurnText: '' };
  }
  let raw;
  try {
    const size = fs.statSync(transcriptPath).size;
    diagnostics.transcript_bytes = size;
    if (size === 0) return { reason: 'transcript_empty', diagnostics, lastTurnText: '' };
    const fd = fs.openSync(transcriptPath, 'r');
    try {
      const len = Math.min(size, MAX_FULL_READ_BYTES);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, size - len);
      raw = buf.toString('utf8');
    } finally { try { fs.closeSync(fd); } catch { /* ignore */ } }
  } catch {
    return { reason: 'transcript_unreadable', diagnostics, lastTurnText: '' };
  }

  // Claude Code writes one JSONL line per content block, lines of one turn sharing message.id.
  const turnIds = new Set();
  let parsed = 0;
  let last = null; // { id, blocks: [], stop_reason }
  let anonymous = 0;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    parsed++;
    if (!row || row.type !== 'assistant' || !row.message) continue;
    const id = row.message.id || `anon-${anonymous++}`;
    turnIds.add(id);
    const blocks = Array.isArray(row.message.content) ? row.message.content : [];
    if (!last || last.id !== id) last = { id, blocks: [], stop_reason: null };
    last.blocks.push(...blocks);
    if (row.message.stop_reason) last.stop_reason = row.message.stop_reason;
  }
  if (parsed === 0) return { reason: 'transcript_parse_error', diagnostics, lastTurnText: '' };
  diagnostics.assistant_turns = turnIds.size;
  if (!last) return { reason: 'no_assistant_turn', diagnostics, lastTurnText: '' };

  diagnostics.last_stop_reason = last.stop_reason;
  const tail = last.blocks[last.blocks.length - 1];
  diagnostics.last_block_type = tail && tail.type ? String(tail.type) : null;
  const toolUses = last.blocks.filter(b => b && b.type === 'tool_use');
  if (toolUses.length) diagnostics.last_tool = String(toolUses[toolUses.length - 1].name || '') || null;
  const texts = last.blocks.filter(b => b && b.type === 'text' && typeof b.text === 'string');
  const lastTurnText = texts.map(b => b.text).join('\n').trim() ? texts.map(b => b.text).join('\n') : '';

  if (!toolUses.length && lastTurnText) return { reason: 'transcript_final_text', diagnostics, lastTurnText };
  if (toolUses.some(b => b.name === HANDBACK_TOOL)) return { reason: 'empty_handback_message', diagnostics, lastTurnText };
  if (toolUses.length) return { reason: 'only_tool_use_in_last_turn', diagnostics, lastTurnText };
  if (texts.length) return { reason: 'empty_last_assistant_message', diagnostics, lastTurnText };
  return { reason: 'no_final_text_block', diagnostics, lastTurnText };
}

module.exports = { diagnoseTranscript, emptyDiagnostics };
