/**
 * hash-tracker.mjs — SHA-256 file hashing for version tracking and update detection.
 *
 * Used by init (write hashes) and update (compare hashes) commands.
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Compute SHA-256 hash of a file.
 * @param {string} filePath
 * @returns {string} hex hash
 */
export function hashFile(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

/**
 * Recursively collect all files in a directory and compute their hashes.
 * @param {string} dir — directory to scan
 * @returns {Record<string, string>} map of relative path → SHA-256 hash
 */
export function hashAllFiles(dir) {
  const result = {};
  if (!existsSync(dir)) return result;

  function walk(currentDir) {
    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      if (entry.name === '.DS_Store' || entry.name === '.bk-version.json') continue;
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else {
        const relPath = relative(dir, fullPath);
        result[relPath] = hashFile(fullPath);
      }
    }
  }

  walk(dir);
  return result;
}
