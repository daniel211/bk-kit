/**
 * design-retry-feedback.test.mjs — Guards the loop that makes an agy retry worth running.
 *
 * design-extract-agy.mjs exits 3 on a contract failure and the workflow re-runs it. Before
 * this module the re-run got the identical prompt, so the model never learned what it got
 * wrong — a real flow burned three attempts and passed on luck. These tests pin the three
 * things that loop depends on: the failure is recorded, it reaches the next prompt framed as
 * a failure, and it is forgotten once a run passes.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  VIOLATIONS_FILENAME, violationsPath, recordViolations, clearViolations, retryFeedbackBlock
} from '../design-retry-feedback.mjs';

/** A throwaway stand-in for one screen's `raw/` directory. */
function rawDir() {
  return mkdtempSync(join(tmpdir(), 'bk-retry-'));
}

test('the file lives under raw/, which no output contract may name', () => {
  const dir = rawDir();
  assert.equal(violationsPath(dir), join(dir, VIOLATIONS_FILENAME));
  assert.equal(VIOLATIONS_FILENAME, 'last-violations.txt');
});

test('a first attempt gets no feedback block at all', () => {
  assert.equal(retryFeedbackBlock(rawDir()), '');
});

test('a recorded failure comes back as the next prompt block, defect lines intact', () => {
  const dir = rawDir();
  const violations = 'design.md breaks Iron Law 2: 2 raw hex values outside Section 4.\n'
    + '   line 41: #ffffff  in  fill=#ffffff\n'
    + '   line 88: #1a1a1a  in  | Title | text #1a1a1a |';

  assert.equal(recordViolations(dir, violations), true);
  assert.ok(existsSync(violationsPath(dir)));

  const block = retryFeedbackBlock(dir);
  // Framed as a rejection, not as advice: unframed violations read as requirements the model
  // believes it already satisfied.
  assert.match(block, /PREVIOUS ATTEMPT AT THIS SCREEN WAS REJECTED/);
  // The specific lines, not a summary of them — that is the entire value of the loop.
  assert.ok(block.includes('line 41: #ffffff'));
  assert.ok(block.includes('line 88: #1a1a1a'));
  assert.ok(block.endsWith('\n\n'), 'it is pasted straight into the prompt before the task');
});

test('a passing run clears the file, so a later run is not haunted by it', () => {
  const dir = rawDir();
  recordViolations(dir, 'design.md has 7 of the 9 required sections.');
  assert.equal(clearViolations(dir), true);
  assert.equal(existsSync(violationsPath(dir)), false);
  assert.equal(retryFeedbackBlock(dir), '');
  assert.equal(clearViolations(dir), false, 'clearing twice is not an error');
});

test('an empty or unreadable file yields no block rather than an empty heading', () => {
  // A heading with nothing under it tells the model it failed and refuses to say how, which
  // is worse than saying nothing.
  const dir = rawDir();
  writeFileSync(violationsPath(dir), '   \n\n', 'utf8');
  assert.equal(retryFeedbackBlock(dir), '');

  // Diagnostics are advisory: a directory that cannot be written must never fail a run that
  // produced a correct spec.
  assert.equal(recordViolations(join(dir, 'does', 'not', 'exist'), 'x'), false);
  assert.equal(retryFeedbackBlock(join(dir, 'does', 'not', 'exist')), '');
});
