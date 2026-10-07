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
 * Result text that means the harness REFUSED the call rather than ran it. Field wording
 * (X-Game-Pro, Claude Code 2.1.291): `<tool_use_error>Error: No such tool available: Bash. Bash
 * is disabled for this session, in subagents as well as here.</tool_use_error>`, the
 * permission layer's "Permission to use X has been denied", and hook blocks.
 */
const DENIAL_RE = /No such tool available|is disabled for this session|(?:permission to use|use of) [\w:-]+ (?:has been|was) denied|tool use was (?:denied|rejected)|user doesn't want to proceed|(?:blocked|denied) by (?:a |the )?(?:pre-?tool|hook)|not allowed to use/i;

/** The SubagentHandback regime marks itself in the first lines: dispatch reminder + tool schema. */
const HANDBACK_TOOL = 'SubagentHandback';
const HANDBACK_REGIME_LINES = 40;

/** Flatten a tool_result `content` (string or [{type:'text',text}]) to text. */
function resultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((b) => (b && typeof b.text === 'string' ? b.text : '')).join('\n');
  return '';
}

/**
 * @param {string|null} transcriptPath
 * @returns {{ readable: boolean, startMs: number|null,
 *   toolUses: Array<{ name: string, input: object, denied: boolean }>,
 *   handbackPending: boolean }}
 *   `denied` — the call did not take effect: the harness refused it, or (for any tool but Bash,
 *   whose is_error is just a non-zero exit of a command that DID run) it errored. A denied
 *   attempt is not evidence of anything the agent did, in either direction.
 *   `handbackPending` — the transcript shows the SubagentHandback regime (Claude Code 2.1.285+)
 *   but the agent has not called it yet: this SubagentStop is the agent's first end_turn, after
 *   which the harness injects "[handback-send-enforce]" and the agent keeps working (X-Game-Pro
 *   2026-10-06: a bk-unit-test-agent stopped at 22:55:47, wrote its report at 22:55:57). It is
 *   not a completion, and judging it rejects a report the agent has not written yet.
 */
function readAgentRun(transcriptPath) {
  const empty = { readable: false, startMs: null, toolUses: [], handbackPending: false };
  if (!transcriptPath) return empty;

  let text;
  try { text = fs.readFileSync(String(transcriptPath), 'utf8'); } catch { return empty; }

  let startMs = null;
  const toolUses = [];
  const byId = new Map();
  let regime = false;
  let handedBack = false;
  let lineNo = 0;

  for (const line of text.split('\n')) {
    const raw = line.trim();
    if (!raw) continue;
    lineNo++;

    if (!regime && lineNo <= HANDBACK_REGIME_LINES && raw.indexOf(HANDBACK_TOOL) !== -1) regime = true;

    // Only lines that can matter are parsed: the first timestamped line, assistant lines
    // carrying tool calls, and the few tool_result lines flagged is_error (a result without
    // that flag cannot be a refusal). Field transcripts reach ~400 KB, mostly tool results.
    const wantStart = startMs === null;
    const hasUse = raw.indexOf('"tool_use"') !== -1;
    const hasErr = !hasUse && raw.indexOf('"is_error":true') !== -1 && raw.indexOf('"tool_result"') !== -1;
    if (!wantStart && !hasUse && !hasErr) continue;

    let row;
    try { row = JSON.parse(raw); } catch { continue; }

    if (wantStart && row && row.timestamp) {
      const t = Date.parse(row.timestamp);
      if (Number.isFinite(t)) startMs = t;
    }

    const content = row && row.message && Array.isArray(row.message.content) ? row.message.content : [];
    for (const block of content) {
      if (!block) continue;
      if (block.type === 'tool_use' && typeof block.name === 'string') {
        if (block.name === HANDBACK_TOOL) handedBack = true;
        const use = { name: block.name, input: block.input && typeof block.input === 'object' ? block.input : {}, denied: false };
        toolUses.push(use);
        if (typeof block.id === 'string') byId.set(block.id, use);
      } else if (block.type === 'tool_result' && block.is_error === true) {
        const use = byId.get(block.tool_use_id);
        if (use && (use.name !== 'Bash' || DENIAL_RE.test(resultText(block.content)))) use.denied = true;
      }
    }
  }

  return { readable: true, startMs, toolUses, handbackPending: regime && !handedBack };
}

/**
 * Tools whose input names a file the agent wrote. NotebookEdit is left out: it edits .ipynb
 * notebooks, which are never a report.
 */
const FILE_WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit']);

/**
 * Every file the agent wrote or edited through a file tool during the run, in call order
 * (calls that errored or were refused wrote nothing and are skipped),
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
    if (!u || u.denied || !FILE_WRITE_TOOLS.has(u.name)) continue;
    const p = u.input && u.input.file_path;
    if (typeof p === 'string' && p.trim()) out.push(p.trim());
  }
  return out;
}

module.exports = { readAgentRun, filesWrittenBy };
