'use strict';
/**
 * jsonl-rotator.cjs — Size-based JSONL rotation library.
 *
 * API:
 *   appendJsonl(filePath, line, options?)  — drop-in for fs.appendFileSync
 *   rotateIfNeeded(filePath, options?)     — explicit rotate check
 *   getRotationStats(filePath)             — { currentSize, rotatedFiles }
 *
 * Rotation scheme:
 *   file.jsonl → file.jsonl.1 → file.jsonl.2 (max kept: keepCount)
 *   Existing .2 is deleted; .1 becomes .2; active becomes .1; fresh file starts.
 *
 * Fail-open: any rotation error logs to stderr and appends to original file.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const DEFAULT_KEEP_COUNT = 2;

/**
 * Rotate file.jsonl → .1 → .2, removing anything beyond keepCount.
 * Uses fs.renameSync (atomic on same filesystem).
 *
 * @param {string} filePath
 * @param {{ maxSizeBytes?: number, keepCount?: number }} options
 * @returns {boolean} true if rotation was performed
 */
function rotateIfNeeded(filePath, options = {}) {
  const maxSizeBytes = options.maxSizeBytes ?? DEFAULT_MAX_SIZE_BYTES;
  const keepCount = options.keepCount ?? DEFAULT_KEEP_COUNT;

  try {
    // Check current file size
    let currentSize = 0;
    try {
      const stat = fs.statSync(filePath);
      currentSize = stat.size;
    } catch {
      // File doesn't exist yet — no rotation needed
      return false;
    }

    // Don't rotate if file is < 50% of maxSize (avoid thrashing)
    if (currentSize < maxSizeBytes * 0.5) return false;
    // Only rotate if at or over maxSize
    if (currentSize < maxSizeBytes) return false;

    _performRotation(filePath, keepCount);
    return true;
  } catch (err) {
    process.stderr.write(`[jsonl-rotator] rotation error for ${filePath}: ${err.message}\n`);
    return false;
  }
}

/**
 * Perform the actual rotation (internal).
 * .2 → deleted, .1 → .2, active → .1
 *
 * @param {string} filePath
 * @param {number} keepCount
 */
function _performRotation(filePath, keepCount) {
  // Delete oldest rotated file beyond keepCount
  for (let i = keepCount; i >= 1; i--) {
    const older = `${filePath}.${i + 1}`;
    try {
      if (fs.existsSync(older)) fs.unlinkSync(older);
    } catch { /* ignore */ }
  }

  // Shift existing rotated files: .1 → .2, etc. (highest first to avoid clobbering)
  for (let i = keepCount - 1; i >= 1; i--) {
    const src = `${filePath}.${i}`;
    const dst = `${filePath}.${i + 1}`;
    try {
      if (fs.existsSync(src)) fs.renameSync(src, dst);
    } catch (err) {
      process.stderr.write(`[jsonl-rotator] rename failed ${src} → ${dst}: ${err.message}\n`);
    }
  }

  // Rotate active file → .1
  try {
    fs.renameSync(filePath, `${filePath}.1`);
  } catch (err) {
    throw new Error(`Failed to rotate ${filePath} → ${filePath}.1: ${err.message}`);
  }
}

/**
 * Append a line to a JSONL file, rotating first if the file would exceed maxSizeBytes.
 * Drop-in replacement for fs.appendFileSync(filePath, line).
 *
 * @param {string} filePath   — absolute or relative path to the .jsonl file
 * @param {string} line       — the line to append (should already include trailing \n)
 * @param {{ maxSizeBytes?: number, keepCount?: number }} [options]
 */
function appendJsonl(filePath, line, options = {}) {
  const maxSizeBytes = options.maxSizeBytes ?? DEFAULT_MAX_SIZE_BYTES;
  const keepCount = options.keepCount ?? DEFAULT_KEEP_COUNT;

  // Ensure directory exists
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    process.stderr.write(`[jsonl-rotator] mkdir failed for ${filePath}: ${err.message}\n`);
    // Still try to append
  }

  // Check if we need to rotate before appending
  try {
    let currentSize = 0;
    try {
      const stat = fs.statSync(filePath);
      currentSize = stat.size;
    } catch {
      currentSize = 0; // file doesn't exist
    }

    const lineLength = Buffer.byteLength(line, 'utf8');

    if (currentSize > 0 && currentSize + lineLength > maxSizeBytes) {
      // Rotate first (fail-open on error)
      try {
        _performRotation(filePath, keepCount);
      } catch (rotErr) {
        process.stderr.write(`[jsonl-rotator] WARN: rotation failed, appending to original: ${rotErr.message}\n`);
      }
    }
  } catch (checkErr) {
    // Fail-open: if size check fails, just append
    process.stderr.write(`[jsonl-rotator] WARN: size check failed for ${filePath}: ${checkErr.message}\n`);
  }

  // Append the line (always — fail-open)
  try {
    fs.appendFileSync(filePath, line, 'utf8');
  } catch (err) {
    process.stderr.write(`[jsonl-rotator] ERROR: append failed for ${filePath}: ${err.message}\n`);
    // Don't rethrow — fail-open
  }
}

/**
 * Get rotation stats for a JSONL file.
 *
 * @param {string} filePath
 * @returns {{ currentSize: number, rotatedFiles: string[] }}
 */
function getRotationStats(filePath) {
  let currentSize = 0;
  try {
    const stat = fs.statSync(filePath);
    currentSize = stat.size;
  } catch {
    currentSize = 0;
  }

  const rotatedFiles = [];
  for (let i = 1; i <= 10; i++) {
    const rotated = `${filePath}.${i}`;
    try {
      fs.statSync(rotated);
      rotatedFiles.push(rotated);
    } catch {
      break; // Stop at first missing rotation
    }
  }

  return { currentSize, rotatedFiles };
}

module.exports = { appendJsonl, rotateIfNeeded, getRotationStats };
