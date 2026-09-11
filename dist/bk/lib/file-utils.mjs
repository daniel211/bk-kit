/**
 * file-utils.mjs — Filesystem utilities for CLI commands.
 *
 * Extracted from scripts/build/file-utils.mjs for use in distributed npm package.
 * Only includes functions needed by CLI (copyDirFiltered).
 */

import { existsSync, mkdirSync, cpSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Files to skip during recursive copy operations */
const SKIP_FILES = new Set(['.DS_Store', '.gitkeep']);

/**
 * Copy an entire directory recursively, skipping .DS_Store and .gitkeep.
 * @param {string} srcDir — source directory
 * @param {string} destDir — destination directory
 * @param {string[]} [excludeNames] — additional file names to skip (top-level only)
 */
export function copyDirFiltered(srcDir, destDir, excludeNames = []) {
  if (!existsSync(srcDir)) return;
  mkdirSync(destDir, { recursive: true });

  const topExcludes = new Set(excludeNames);

  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    if (SKIP_FILES.has(entry.name)) continue;
    if (topExcludes.has(entry.name)) continue;
    const srcPath = join(srcDir, entry.name);
    const destPath = join(destDir, entry.name);

    if (entry.isDirectory()) {
      copyDirFiltered(srcPath, destPath);
    } else {
      cpSync(srcPath, destPath);
    }
  }
}
