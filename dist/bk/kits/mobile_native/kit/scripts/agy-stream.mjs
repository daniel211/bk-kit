/**
 * agy-stream.mjs — Read what the Antigravity CLI ("agy") actually says back.
 *
 * Every agy caller in the kit hits the same three surprises, each found the hard way:
 *
 *   1. The result arrives as a nested NDJSON event, `{event:"result", result:{...}}` — not
 *      as a top-level object. Looking for the payload at the top level silently finds
 *      nothing and reports an empty response.
 *   2. `--json-schema` makes agy append its own schema-conformant object AFTER the model's
 *      answer, so the response is two JSON objects back to back and `JSON.parse` on the
 *      whole string dies at the boundary.
 *   3. The model still wraps JSON in markdown fences sometimes, schema or not.
 *
 * Extracted here so a new runner inherits the answers instead of rediscovering them.
 */

/**
 * Pull the terminal result object out of agy's NDJSON stream.
 *
 * @param {string} stdoutData
 * @returns {object|null} the `result` payload, or null when the stream carried none
 */
export function extractResultEvent(stdoutData) {
  for (const line of String(stdoutData).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let event;
    try {
      event = JSON.parse(trimmed);
    } catch (_) {
      continue;              // progress lines and CLI chatter are not all valid JSON
    }
    if (event && event.event === 'result' && event.result) return event.result;
    // `--output-format json` (rather than stream-json) emits the payload unwrapped.
    if (event && (event.status || event.conversation_id) && !event.event) return event;
  }
  return null;
}

/**
 * Strip a markdown code fence from a model answer.
 *
 * @param {string} text
 * @returns {string}
 */
export function stripFences(text) {
  const trimmed = String(text).trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
}

/**
 * Yield each complete top-level `{...}` in `text`, tracking string state so braces inside
 * string literals do not throw the depth count off.
 *
 * @param {string} text
 * @yields {string}
 */
export function* jsonObjectsIn(text) {
  let depth = 0, start = -1, inString = false, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      if (depth === 0) continue;               // stray brace, ignore
      depth--;
      if (depth === 0 && start >= 0) {
        yield text.slice(start, i + 1);
        start = -1;
      }
    }
  }
}

/**
 * Pull the object the caller actually wants out of a model answer.
 *
 * Keyed on a predicate rather than on parse success, because several shapes here are valid
 * JSON without being the answer: an `--output-format json` envelope, or agy's trailing
 * structured-output object. "It parsed" is not the same as "it is the thing".
 *
 * @param {string} rawOutput
 * @param {(candidate: object) => boolean} looksRight
 * @returns {object|null}
 */
export function parseStructuredOutput(rawOutput, looksRight) {
  const text = stripFences(rawOutput);

  // Fast path: the whole response is exactly the answer.
  try {
    const whole = JSON.parse(text);
    if (whole && looksRight(whole)) return whole;
    // Legacy envelope: model text nested under `response`.
    if (whole && typeof whole.response === 'string') {
      const inner = JSON.parse(stripFences(whole.response));
      if (inner && looksRight(inner)) return inner;
    }
  } catch (_) {
    // Fall through — concatenated or prose-wrapped output lands here.
  }

  for (const candidate of jsonObjectsIn(text)) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && looksRight(parsed)) return parsed;
    } catch (_) { /* not this one */ }
  }

  return null;
}
