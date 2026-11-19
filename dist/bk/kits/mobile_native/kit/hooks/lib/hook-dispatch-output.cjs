#!/usr/bin/env node
'use strict';
/**
 * hook-dispatch-output.cjs — fold many hooks' exit codes and stdout back into one process's.
 *
 * Claude Code reads each hook process separately today: its own exit code, its own stdout parsed
 * as its own JSON document. A dispatcher has one of each, so the per-hook results have to be
 * combined without changing what any single hook meant.
 *
 * Exit code — exit 2 is how a hook BLOCKS a tool call, so it dominates: any 2 makes the dispatch
 * a 2. Other non-zero codes are "hook errored, tell the user"; they are kept only when nothing
 * blocked. A hook that timed out or threw contributes 0, because every hook in this kit is
 * written to fail open and a dispatcher-level fault must not invent a block that the hook itself
 * never asked for.
 *
 * stdout — each hook writes either a JSON object or plain text. Two JSON objects concatenated are
 * not a JSON document, so they are merged into one object instead:
 *   - `permissionDecision` deny/ask beats allow, and the FIRST denial's reason is the one kept,
 *     which preserves ordering (global-kill-switch runs first and its halt message wins).
 *   - `additionalContext` from several hooks is joined by newline — all of it reaches Claude, the
 *     same as when each hook had its own process.
 *   - plain-text stdout is carried in `additionalContext` when any hook emitted JSON, and passed
 *     through untouched when none did (which is how SessionStart/UserPromptSubmit context works).
 *
 * Delivery — shapeForEvent() then puts the merged context where Claude Code actually reads it
 * for this event. "All of it reaches Claude" above was not true: a bare top-level
 * `{additionalContext}` is recorded in the transcript as a `hook_success` attachment with
 * `content: ""` and never shown to the model. Counted over ~/.claude/projects (last 40 days):
 * 334 PreToolUse and 432 PostToolUse main-session hook_success rows whose stdout was bare
 * `{additionalContext}`, every one with empty content; the only PreToolUse context the model saw
 * (166 `hook_additional_context` rows) came from dispatches where some hook in the group happened
 * to print `hookSpecificOutput`, which dragged the bare text along. The field's
 * `[AGENT-OUTPUT-REJECTED] … failed 10x` lived only in those stdout fields.
 */

/** Decisions ordered by how much they restrict; the strongest one present wins. */
const DECISION_RANK = { allow: 0, ask: 1, deny: 2 };

/** Parse a hook's stdout into either a JSON object or a plain-text chunk. */
function classify(stdout) {
  const trimmed = String(stdout || '').trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith('{')) return { kind: 'text', text: trimmed };
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return { kind: 'json', json: parsed };
  } catch { /* not a JSON document — treat as text */ }
  return { kind: 'text', text: trimmed };
}

/** Append a value to a newline-joined accumulator, skipping empties. */
function joinLine(existing, addition) {
  if (!addition) return existing;
  return existing ? `${existing}\n${addition}` : addition;
}

/**
 * Merge the per-hook stdout strings, in hook order, into one stdout string.
 *
 * @param {Array<{script: string, stdout: string}>} results
 * @returns {string} what the dispatcher should write to its own stdout
 */
function mergeStdout(results) {
  const chunks = results.map((r) => classify(r.stdout)).filter(Boolean);
  if (chunks.length === 0) return '';

  const jsonChunks = chunks.filter((c) => c.kind === 'json');
  const textChunks = chunks.filter((c) => c.kind === 'text');

  // Nothing structured: this is the plain-context case, and concatenation is exactly what
  // several separate hook processes would have produced.
  if (jsonChunks.length === 0) return `${textChunks.map((c) => c.text).join('\n')}\n`;

  const merged = {};
  let hookSpecific = null;
  let context = '';
  let systemMessage = '';
  let bestDecision = -1;

  for (const chunk of jsonChunks) {
    const obj = chunk.json;

    // Top-level fields where the more restrictive value wins.
    if (obj.continue === false) merged.continue = false;
    if (obj.stopReason && !merged.stopReason) merged.stopReason = obj.stopReason;
    if (obj.decision === 'block') {
      merged.decision = 'block';
      if (!merged.reason) merged.reason = obj.reason;
    }
    if (obj.suppressOutput === true && merged.suppressOutput !== false) merged.suppressOutput = true;
    if (obj.suppressOutput === false) merged.suppressOutput = false;
    if (obj.systemMessage) systemMessage = joinLine(systemMessage, obj.systemMessage);
    if (obj.additionalContext) context = joinLine(context, obj.additionalContext);

    const hso = obj.hookSpecificOutput;
    if (hso && typeof hso === 'object') {
      hookSpecific = hookSpecific || {};
      if (hso.hookEventName) hookSpecific.hookEventName = hso.hookEventName;
      if (hso.additionalContext) context = joinLine(context, hso.additionalContext);
      const rank = DECISION_RANK[hso.permissionDecision];
      if (rank !== undefined && rank > bestDecision) {
        bestDecision = rank;
        hookSpecific.permissionDecision = hso.permissionDecision;
        hookSpecific.permissionDecisionReason = hso.permissionDecisionReason;
      }
      for (const [key, value] of Object.entries(hso)) {
        if (['hookEventName', 'additionalContext', 'permissionDecision', 'permissionDecisionReason'].includes(key)) continue;
        if (hookSpecific[key] === undefined) hookSpecific[key] = value;
      }
    }
  }

  // Plain text from a hook that ran alongside a JSON-emitting one still has to reach Claude.
  for (const chunk of textChunks) context = joinLine(context, chunk.text);

  if (systemMessage) merged.systemMessage = systemMessage;
  if (context) {
    if (hookSpecific) hookSpecific.additionalContext = context;
    else merged.additionalContext = context;
  }
  if (hookSpecific) merged.hookSpecificOutput = hookSpecific;

  return `${JSON.stringify(merged)}\n`;
}

/**
 * Events whose `hookSpecificOutput.additionalContext` reaches a model — verified in transcripts as
 * `hook_additional_context` attachments: PreToolUse (main), PostToolUse (main), SubagentStart
 * (the subagent's own sidechain — that is its audience). UserPromptSubmit and SessionStart are
 * the two events whose plain stdout is itself added as context (every such row in the field has
 * non-empty `content`), and hookSpecificOutput is valid on them too.
 */
const MODEL_CONTEXT_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'SubagentStart', 'UserPromptSubmit', 'SessionStart']);

/** Of those, the events where plain stdout already works and is left exactly as it was. */
const PLAIN_TEXT_EVENTS = new Set(['UserPromptSubmit', 'SessionStart']);

/**
 * Events whose output reaches nobody, but whose words are for the conductor. SubagentStop output
 * lands only in the subagent's own transcript (skill-chain-suggest's `[SUGGEST-NEXT]` in
 * X-Game-Pro agent-a6722278dade32579.jsonl and fusionworkomni agent-abde7f4fe706b884b.jsonl, and
 * in no main transcript). Its text goes to the session's conductor inbox (conductor-inbox.cjs),
 * delivered on the conductor's next event.
 *
 * Deliberately NOT routed:
 *   - Stop. Its only speaker is pattern-extractor's per-turn `[PATTERN-INSIGHTS] Workflow health
 *     looks good…` — 660 rows in the field, one per turn. Routed, that becomes a line injected
 *     at the start of every turn describing the turn before. Stop-time work that matters to the
 *     next turn already has its own channel (lint findings via lint-findings-inject).
 *   - SessionEnd. The session is over; an inbox keyed by it would only be reaped.
 *   - PreCompact, TaskCompleted, TeammateIdle, Notification — nothing in the kit prints context
 *     on them except the team handlers, which already emit hookSpecificOutput.
 * Their stdout is left exactly as the hooks wrote it.
 */
const CONDUCTOR_INBOX_EVENTS = new Set(['SubagentStop']);

/**
 * Put merged stdout where this event delivers it.
 *
 * @param {string} stdout — mergeStdout()'s result
 * @param {string|null} event — hook_event_name from the payload
 * @returns {{ stdout: string, conductorText: string|null }} what to print, and what (if
 *   anything) must go to the conductor inbox instead
 */
function shapeForEvent(stdout, event) {
  const unchanged = { stdout, conductorText: null };
  const chunk = classify(stdout);
  if (!chunk || !event) return unchanged;

  if (MODEL_CONTEXT_EVENTS.has(event)) {
    if (chunk.kind === 'text') {
      if (PLAIN_TEXT_EVENTS.has(event)) return unchanged;
      return {
        stdout: `${JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: chunk.text } })}\n`,
        conductorText: null
      };
    }
    const obj = { ...chunk.json };
    const bare = obj.additionalContext;
    const hso = obj.hookSpecificOutput && typeof obj.hookSpecificOutput === 'object'
      ? { ...obj.hookSpecificOutput }
      : null;
    if (!bare) {
      // Already shaped. Only a missing hookEventName is filled in — it is required.
      if (hso && !hso.hookEventName) {
        obj.hookSpecificOutput = { hookEventName: event, ...hso };
        return { stdout: `${JSON.stringify(obj)}\n`, conductorText: null };
      }
      return unchanged;
    }
    delete obj.additionalContext;
    const target = hso || {};
    obj.hookSpecificOutput = {
      ...target,
      hookEventName: target.hookEventName || event,
      additionalContext: joinLine(target.additionalContext || '', bare)
    };
    return { stdout: `${JSON.stringify(obj)}\n`, conductorText: null };
  }

  if (CONDUCTOR_INBOX_EVENTS.has(event)) {
    if (chunk.kind === 'text') return { stdout: '', conductorText: chunk.text };
    const obj = { ...chunk.json };
    let text = obj.additionalContext || '';
    delete obj.additionalContext;
    if (obj.hookSpecificOutput && typeof obj.hookSpecificOutput === 'object') {
      const hso = { ...obj.hookSpecificOutput };
      text = joinLine(text, hso.additionalContext || '');
      delete hso.additionalContext;
      const rest = Object.keys(hso).filter((k) => k !== 'hookEventName');
      if (rest.length > 0) obj.hookSpecificOutput = hso;
      else delete obj.hookSpecificOutput;
    }
    // Anything else (a `decision: "block"` meant for the subagent, say) still goes to stdout.
    const out = Object.keys(obj).length > 0 ? `${JSON.stringify(obj)}\n` : '';
    return { stdout: out, conductorText: text || null };
  }

  return unchanged;
}

/**
 * The exit code the dispatcher should use.
 *
 * @param {Array<{exitCode: number|null, status: string}>} results
 * @returns {number}
 */
function mergeExitCode(results) {
  let fallback = 0;
  for (const r of results) {
    if (r.status !== 'ok') continue; // timeout/throw is a dispatcher fault; never fabricate a block
    const code = Number(r.exitCode) || 0;
    if (code === 2) return 2;
    if (code !== 0 && fallback === 0) fallback = code;
  }
  return fallback;
}

/** stderr in hook order — the same bytes, the same sequence, as the separate processes wrote. */
function mergeStderr(results) {
  return results.map((r) => r.stderr || '').join('');
}

module.exports = {
  mergeStdout, mergeExitCode, mergeStderr, classify, shapeForEvent,
  MODEL_CONTEXT_EVENTS, PLAIN_TEXT_EVENTS, CONDUCTOR_INBOX_EVENTS
};
