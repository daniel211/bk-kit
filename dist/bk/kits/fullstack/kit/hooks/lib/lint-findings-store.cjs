/**
 * lint-findings-store.cjs — the handoff between a detached lint worker and the next turn.
 *
 * Lint used to be reported on stderr from inside the Stop hook, which forced the linter to run
 * inline. Measured cost of native-lint-flush across 20 Stop events in fusionworkomni:
 * [4485, 2732, 2076, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0] ms. 17 of 20 Stops had
 * nothing queued and cost about 1ms; the 3 that had work held the end of the turn for 2.0–4.5
 * seconds — a spike exactly when the user had just produced code, not a flat tax. For scale the
 * next most expensive Stop hook, checkpoint-save, tops out at 141ms.
 *
 * So the linter moved to a detached worker, and its findings have to survive the worker's exit.
 * They land here as JSONL and are injected into the next user turn by the UserPromptSubmit
 * hook, which claims the file by rename so a finding is delivered exactly once.
 *
 * The claim takes EVERY pending record, not just this session's. Two reasons: a record adopted
 * from an orphan queue carries a dead session's id and would otherwise never be delivered to
 * anyone, and the findings describe files in the repo the user is looking at either way.
 * Delivering another live session's finding once is cheap; losing one is not.
 *
 * Exports:
 *   findingsPath(projectRoot)
 *   appendFinding(projectRoot, record)
 *   takeFindings(projectRoot) — claim-by-rename, returns the records
 */

'use strict';

const fs = require('fs');
const path = require('path');

const FINDINGS_FILE = 'lint-findings.jsonl';

/** @param {string} projectRoot @returns {string} */
function findingsPath(projectRoot) {
  return path.join(projectRoot, '.bk-metrics', FINDINGS_FILE);
}

/**
 * Append one findings record. Append-only, so two workers finishing together cannot clobber
 * each other (a single appendFileSync of a short line is atomic on POSIX under O_APPEND).
 *
 * @param {string} projectRoot
 * @param {{ kind: string, session_id?: string|null, text: string, files?: number }} record
 * @returns {boolean}
 */
function appendFinding(projectRoot, record) {
  if (!projectRoot || !record || typeof record.text !== 'string' || !record.text) return false;
  try {
    const file = findingsPath(projectRoot);
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(file, JSON.stringify({ ts: Date.now(), ...record }) + '\n', 'utf8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Claim every pending findings record: rename the file aside, read it, delete the copy.
 *
 * Same rename-then-read claim lint-queue.cjs uses, for the same reason: a worker that finishes
 * mid-claim starts a fresh file instead of having its record read and then truncated away.
 *
 * @param {string} projectRoot
 * @returns {object[]} records, oldest first ([] when there was nothing pending)
 */
function takeFindings(projectRoot) {
  if (!projectRoot) return [];
  const file = findingsPath(projectRoot);
  const claim = `${file}.claiming-${process.pid}`;
  try {
    if (!fs.existsSync(file)) return [];
    fs.renameSync(file, claim);
  } catch {
    return []; // another reader won the race, or it vanished
  }

  let raw = '';
  try { raw = fs.readFileSync(claim, 'utf8'); } catch { raw = ''; }
  try { fs.unlinkSync(claim); } catch { /* fail-open */ }

  const records = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const rec = JSON.parse(trimmed);
      if (rec && typeof rec.text === 'string' && rec.text) records.push(rec);
    } catch { /* skip a malformed line rather than losing the batch */ }
  }
  return records;
}

module.exports = { findingsPath, appendFinding, takeFindings, FINDINGS_FILE };
