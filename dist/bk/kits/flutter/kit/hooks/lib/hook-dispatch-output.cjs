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

module.exports = { mergeStdout, mergeExitCode, mergeStderr, classify };
