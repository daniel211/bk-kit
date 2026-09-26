/**
 * agent-run-evidence.cjs — what a finished subagent actually did, read from its own transcript.
 *
 * verify-output used to judge an agent by the PostToolUse(Task|Agent) `tool_response`. Claude
 * Code now runs Agent/Task calls in the background by default, and for a background call that
 * hook fires ~2s after LAUNCH with a tool_response of "Async agent launched successfully…" —
 * launch metadata, not a record of the agent's work. Measured in X-Game-Pro on 2026-09-23
 * (kit 0.10.1): every dispatch was checked before its report could exist, and
 * `bk-ios-developer failed 10x` was every single dispatch counted as a failure. The
 * tool-restriction scan read the same launch metadata, so it could never see a forbidden tool.
 *
 * SubagentStop fires at real completion and carries `agent_transcript_path`: the subagent's
 * own JSONL transcript. Each assistant line holds the agent's tool calls as content blocks,
 * `{"type":"tool_use","name":"Bash","input":{"command":"…"}}`, and every line carries an ISO
 * `timestamp` — the first line is the dispatch prompt, so its timestamp is when the agent
 * started. Both shapes were checked against real transcripts in
 * ~/.claude/projects/<repo>/<session>/subagents/agent-<id>.jsonl.
 *
 * Fail-open: an unreadable or missing transcript yields `{ readable: false }`, and callers skip
 * the checks that need it rather than guessing.
 */

'use strict';

const fs = require('fs');

/**
 * @param {string|null} transcriptPath
 * @returns {{ readable: boolean, startMs: number|null, toolUses: Array<{ name: string, input: object }> }}
 */
function readAgentRun(transcriptPath) {
  const empty = { readable: false, startMs: null, toolUses: [] };
  if (!transcriptPath) return empty;

  let text;
  try { text = fs.readFileSync(String(transcriptPath), 'utf8'); } catch { return empty; }

  let startMs = null;
  const toolUses = [];

  for (const line of text.split('\n')) {
    const raw = line.trim();
    if (!raw) continue;

    // Only lines that can matter are parsed: the first timestamped line, and assistant lines
    // carrying tool calls. Field transcripts reach ~400 KB, most of it tool results.
    const wantStart = startMs === null;
    if (!wantStart && raw.indexOf('"tool_use"') === -1) continue;

    let row;
    try { row = JSON.parse(raw); } catch { continue; }

    if (wantStart && row && row.timestamp) {
      const t = Date.parse(row.timestamp);
      if (Number.isFinite(t)) startMs = t;
    }

    const content = row && row.message && Array.isArray(row.message.content) ? row.message.content : [];
    for (const block of content) {
      if (block && block.type === 'tool_use' && typeof block.name === 'string') {
        toolUses.push({ name: block.name, input: block.input && typeof block.input === 'object' ? block.input : {} });
      }
    }
  }

  return { readable: true, startMs, toolUses };
}

/**
 * Tools whose input names a file the agent wrote. NotebookEdit is left out: it edits .ipynb
 * notebooks, which are never a report.
 */
const FILE_WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit']);

/**
 * Every file the agent wrote or edited through a file tool during the run, in call order,
 * as the path it passed (absolute in practice; callers resolve relative ones).
 *
 * Bash writes (`cat > x <<EOF`, `tee`, `> x`) are deliberately not parsed: shell quoting makes
 * any regex over them both leaky and wrong, and the caller keeps a filesystem fallback that
 * covers an agent which wrote its report that way.
 *
 * @param {Array<{ name: string, input: object }>} toolUses
 * @returns {string[]}
 */
function filesWrittenBy(toolUses) {
  const out = [];
  for (const u of toolUses || []) {
    if (!u || !FILE_WRITE_TOOLS.has(u.name)) continue;
    const p = u.input && u.input.file_path;
    if (typeof p === 'string' && p.trim()) out.push(p.trim());
  }
  return out;
}

module.exports = { readAgentRun, filesWrittenBy };
