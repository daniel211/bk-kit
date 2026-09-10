/**
 * design-retry-feedback.mjs — Carry a contract failure into the next attempt's prompt.
 *
 * design-extract-agy.mjs exits 3 when the output breaks the contract: a missing section, a
 * malformed assets.json, a raw hex outside Section 4. design-workflow.md then retries — and
 * until this module existed it retried with the *identical* prompt, so the model was never
 * told what it had got wrong. A real flow needed three attempts and the third passing was
 * luck, not learning.
 *
 * So the violations are written to disk on failure and read back into the next prompt. The
 * file lives under the screen's `raw/` directory because `raw/` is regenerated data that no
 * output contract may name — putting it beside design.md would make it look like a
 * deliverable. It is deleted the moment a run passes, so a later unrelated run over the same
 * screen is not haunted by a failure that has already been fixed.
 *
 * Everything here is advisory: a write that fails must never turn a run that produced a
 * correct spec into a failure, and a read that fails simply means no feedback this time.
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

/** Basename of the feedback file. Under raw/ — regenerated data, never an output. */
export const VIOLATIONS_FILENAME = 'last-violations.txt';

/**
 * @param {string} rawDir the screen's `raw/` directory
 * @returns {string}
 */
export function violationsPath(rawDir) {
  return join(rawDir, VIOLATIONS_FILENAME);
}

/**
 * Record why this attempt was rejected, for the next attempt to read.
 *
 * @param {string} rawDir
 * @param {string} text the same message and detail the run printed to stderr
 * @returns {boolean} whether it was written
 */
export function recordViolations(rawDir, text) {
  try {
    writeFileSync(violationsPath(rawDir), `${String(text).trim()}\n`, 'utf8');
    return true;
  } catch (_) {
    return false;   // advisory only — never fail a run over its own diagnostics
  }
}

/**
 * Forget the last failure. Called on a passing run.
 *
 * @param {string} rawDir
 * @returns {boolean} whether a file was removed
 */
export function clearViolations(rawDir) {
  const path = violationsPath(rawDir);
  try {
    if (!existsSync(path)) return false;
    unlinkSync(path);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * The prompt section describing the previous attempt's defects, or '' when there is none.
 *
 * Returned as a whole block rather than as raw text so the caller cannot accidentally paste
 * violations into the prompt without the heading that says what they are. Without that
 * framing the model reads them as requirements it has already met.
 *
 * @param {string} rawDir
 * @returns {string} markdown ending in a blank line, or ''
 */
export function retryFeedbackBlock(rawDir) {
  let body = '';
  try {
    const path = violationsPath(rawDir);
    if (!existsSync(path)) return '';
    body = readFileSync(path, 'utf8').trim();
  } catch (_) {
    return '';
  }
  if (!body) return '';

  return `## YOUR PREVIOUS ATTEMPT AT THIS SCREEN WAS REJECTED

An earlier attempt wrote this same screen and the automated contract check threw it out.
What follows is not general advice — it is the exact list of defects that attempt produced.
Fix every one of them. The run fails again if any of these lines still describes your output.

${body}

`;
}
