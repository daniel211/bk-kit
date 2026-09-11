/**
 * inferential-queue.cjs — JSONL queue for inferential-review batching.
 *
 * Append-only queue that accumulates file-edit entries. When batch_size
 * is reached, the inferential-review hook triggers Tier 3 (LLM judge) and
 * clears the queue via clearQueue().
 *
 * All operations fail-open: errors are logged to stderr but never throw.
 *
 * Exports:
 *   enqueueEdit(entry, queueFile)  — append entry to JSONL queue
 *   readQueue(queueFile)           — read all current entries
 *   clearQueue(queueFile)          — truncate queue after Tier 3 fires
 *   getQueueSize(queueFile)        — lightweight line count (no parse)
 */

'use strict';

const fs = require('fs');
const path = require('path');

const MODULE = '[inferential-queue]';

/**
 * Ensure parent directory exists for a file path.
 * @param {string} filePath
 */
function ensureDir(filePath) {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch (e) {
    process.stderr.write(`${MODULE} ensureDir error: ${e.message}\n`);
  }
}

/**
 * Append a single edit entry to the JSONL queue file.
 * Uses appendFileSync for append-only safety (no read-modify-write race).
 *
 * @param {object} entry   — arbitrary JSON-serialisable object
 * @param {string} queueFile — absolute path to queue JSONL file
 * @returns {boolean} true on success
 */
function enqueueEdit(entry, queueFile) {
  if (!queueFile) {
    process.stderr.write(`${MODULE} enqueueEdit: queueFile is required\n`);
    return false;
  }
  try {
    ensureDir(queueFile);
    const line = JSON.stringify({ ts: Date.now(), ...entry }) + '\n';
    fs.appendFileSync(queueFile, line, 'utf8');
    return true;
  } catch (e) {
    process.stderr.write(`${MODULE} enqueueEdit error: ${e.message}\n`);
    return false;
  }
}

/**
 * Read all valid entries from the JSONL queue file.
 * Silently skips malformed lines (don't crash on corrupt queue).
 *
 * @param {string} queueFile — absolute path to queue JSONL file
 * @returns {object[]} array of parsed entries (may be empty)
 */
function readQueue(queueFile) {
  if (!queueFile) return [];
  try {
    if (!fs.existsSync(queueFile)) return [];
    const raw = fs.readFileSync(queueFile, 'utf8');
    const entries = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        entries.push(JSON.parse(trimmed));
      } catch {
        // Malformed line — skip silently
        process.stderr.write(`${MODULE} readQueue: skipping malformed line\n`);
      }
    }
    return entries;
  } catch (e) {
    process.stderr.write(`${MODULE} readQueue error: ${e.message}\n`);
    return [];
  }
}

/**
 * Truncate the queue file to zero bytes after Tier 3 fires.
 * Uses a write with empty content for atomicity (not unlink, to preserve inode).
 *
 * @param {string} queueFile — absolute path to queue JSONL file
 * @returns {boolean} true on success
 */
function clearQueue(queueFile) {
  if (!queueFile) return false;
  try {
    if (!fs.existsSync(queueFile)) return true; // already clear
    fs.writeFileSync(queueFile, '', 'utf8');
    return true;
  } catch (e) {
    process.stderr.write(`${MODULE} clearQueue error: ${e.message}\n`);
    return false;
  }
}

/**
 * Lightweight line count — reads file as string, counts newlines.
 * Does NOT parse JSON. Returns 0 if file missing or empty.
 *
 * @param {string} queueFile — absolute path to queue JSONL file
 * @returns {number}
 */
function getQueueSize(queueFile) {
  if (!queueFile) return 0;
  try {
    if (!fs.existsSync(queueFile)) return 0;
    const raw = fs.readFileSync(queueFile, 'utf8');
    // Count non-empty lines
    return raw.split('\n').filter(l => l.trim().length > 0).length;
  } catch (e) {
    process.stderr.write(`${MODULE} getQueueSize error: ${e.message}\n`);
    return 0;
  }
}

module.exports = { enqueueEdit, readQueue, clearQueue, getQueueSize };
