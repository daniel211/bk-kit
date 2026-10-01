/**
 * subagent-final-message.cjs - the text a subagent ended its run with.
 *
 * Since Claude Code 2.1.285 a subagent finishes by calling the harness tool
 * `SubagentHandback({message})`. Its last assistant block is then a tool_use, not text, so the
 * SubagentStop payload's `last_assistant_message` is "" and every hook that classified that
 * field saw a silent agent (21/23 and 18/28 field trace rows were `no_output`, and a real
 * `Status: blocked` was never seen). When the handback is denied (session not in auto mode) the
 * agent retries with the same message and ends with a plain text message, so both shapes exist.
 *
 * Resolution order:
 *   1. a non-empty `last_assistant_message` on the payload (plain text ending);
 *   2. the `input.message` of the LAST `SubagentHandback` tool_use in `agent_transcript_path`;
 *   3. "".
 *
 * Never throws: a missing/unreadable transcript, bad JSON lines, or a non-string message all
 * fall through to the next source. Only the tail of the transcript is read.
 */

'use strict';

const fs = require('fs');

const TAIL_BYTES = 256 * 1024;
const HANDBACK_TOOL = 'SubagentHandback';

/** Last ~256KB of a file as text, or "" when unreadable. A cut first line fails to parse and is skipped. */
function readTail(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, TAIL_BYTES);
    if (len <= 0) return '';
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    return buf.toString('utf8');
  } catch {
    return '';
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* ignore */ } }
  }
}

/** `input.message` of the last SubagentHandback tool_use with a non-empty string message, else "". */
function lastHandbackMessage(transcriptPath) {
  if (!transcriptPath || typeof transcriptPath !== 'string') return '';
  const lines = readTail(transcriptPath).split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line || line.indexOf(HANDBACK_TOOL) === -1) continue; // cheap prefilter before JSON.parse
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    const content = row && row.message && row.message.content;
    if (!row || row.type !== 'assistant' || !Array.isArray(content)) continue;
    for (let j = content.length - 1; j >= 0; j--) {
      const block = content[j];
      if (block && block.type === 'tool_use' && block.name === HANDBACK_TOOL
        && block.input && typeof block.input.message === 'string' && block.input.message.trim()) {
        return block.input.message;
      }
    }
  }
  return '';
}

/** @returns {{ message: string, source: 'payload'|'handback'|'none' }} */
function resolveFinalMessageWithSource(hookData) {
  try {
    const data = hookData || {};
    if (typeof data.last_assistant_message === 'string' && data.last_assistant_message.trim()) {
      return { message: data.last_assistant_message, source: 'payload' };
    }
    const handback = lastHandbackMessage(data.agent_transcript_path || data.agentTranscriptPath);
    if (handback) return { message: handback, source: 'handback' };
  } catch { /* fall through */ }
  return { message: '', source: 'none' };
}

/** @returns {string} the agent's final message, or "" */
function resolveFinalMessage(hookData) {
  return resolveFinalMessageWithSource(hookData).message;
}

module.exports = { resolveFinalMessage, resolveFinalMessageWithSource, lastHandbackMessage };
