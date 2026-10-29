/**
 * codex-stream.mjs — Read what the OpenAI Codex CLI (`codex exec`) says back.
 *
 * Two channels carry the answer, and a runner should use both:
 *
 *   1. `-o <file>` (`--output-last-message`) — Codex writes the final agent message to that
 *      file. With `--output-schema` the message is meant to be bare JSON, but a model can still
 *      wrap it in fences or prose, so it goes through the same tolerant parser as agy output.
 *   2. `--json` stdout — one JSONL event per line. The final answer is the last
 *      `{"type":"item.completed","item":{"type":"agent_message","text":...}}`; failures arrive
 *      as `{"type":"error","message":...}` or `{"type":"turn.failed","error":{"message":...}}`.
 *      Used as the fallback when the `-o` file is missing or empty, and as the source of the
 *      CLI's own error text when the run failed.
 *
 * The JSON-extraction helpers are not model-specific; they are imported from agy-stream.mjs
 * rather than copied, so a fix to the fence/concatenation handling lands in both runners.
 */

import { existsSync, readFileSync } from 'node:fs';
import { parseStructuredOutput } from './agy-stream.mjs';

export { parseStructuredOutput, stripFences, jsonObjectsIn } from './agy-stream.mjs';

/**
 * Parse every JSON line of a `codex exec --json` stdout, skipping non-JSON chatter.
 *
 * @param {string} stdoutData
 * @returns {object[]}
 */
export function parseJsonlEvents(stdoutData) {
  const events = [];
  for (const line of String(stdoutData).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const event = JSON.parse(trimmed);
      if (event && typeof event === 'object') events.push(event);
    } catch (_) { /* partial or non-JSON line */ }
  }
  return events;
}

/**
 * The text of the last completed agent message in the JSONL stream.
 *
 * @param {string} stdoutData
 * @returns {string|null}
 */
export function extractLastAgentMessage(stdoutData) {
  let text = null;
  for (const event of parseJsonlEvents(stdoutData)) {
    const item = event.item;
    if (event.type === 'item.completed' && item && item.type === 'agent_message'
      && typeof item.text === 'string') {
      text = item.text;
    }
  }
  return text;
}

/**
 * The error Codex reported in its JSONL stream, if any — the last one wins, because Codex can
 * emit a retryable `error` before a terminal `turn.failed`.
 *
 * @param {string} stdoutData
 * @returns {string|null}
 */
export function extractStreamError(stdoutData) {
  let message = null;
  for (const event of parseJsonlEvents(stdoutData)) {
    if (event.type === 'error') {
      message = String(event.message || (event.error && event.error.message) || 'unknown error');
    } else if (event.type === 'turn.failed') {
      message = String((event.error && event.error.message) || event.message || 'turn failed');
    }
  }
  return message;
}

/**
 * Read the final message from the `-o` file, falling back to the JSONL stream.
 *
 * @param {string|null} lastMessagePath
 * @param {string} stdoutData
 * @returns {string|null}
 */
export function readFinalMessage(lastMessagePath, stdoutData) {
  if (lastMessagePath && existsSync(lastMessagePath)) {
    try {
      const text = readFileSync(lastMessagePath, 'utf8');
      if (text.trim()) return text;
    } catch (_) { /* fall through to the stream */ }
  }
  return extractLastAgentMessage(stdoutData);
}

/**
 * Pull the review object out of a Codex answer — keyed on a `findings` array, like the agy
 * runner, because "it parsed" is not the same as "it is the review".
 *
 * @param {string} text
 * @returns {object|null}
 */
export function parseReviewJson(text) {
  if (!text) return null;
  return parseStructuredOutput(text, (o) => Array.isArray(o.findings));
}
