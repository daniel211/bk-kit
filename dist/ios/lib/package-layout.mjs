/**
 * package-layout.mjs — What a kit install consists of, and where each file comes from.
 *
 * `init` writes two trees into a project's .claude/: the kit itself (from the package's
 * kit/) and the developer CLIs (from the package's cli/). Only the first is inventoried
 * by kit-manifest.json. When `update` compared the recorded install against that manifest
 * alone, every cli/ path looked like a file the package had dropped: it printed eighteen
 * "removed from package" warnings and never upgraded a CLI file, so bk-health and the
 * steerer stayed frozen at whatever version init first installed.
 *
 * Both commands now share this module so they cannot drift apart again.
 */

import { existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import { hashAllFiles } from './hash-tracker.mjs';

/** Paths under this prefix live in the package root, not in kit/. */
const CLI_PREFIX = 'cli';

/**
 * Is this installed path part of the CLI tree rather than the kit tree?
 *
 * @param {string} relPath — path relative to .claude/, e.g. "cli/bk-health/index.cjs"
 * @returns {boolean}
 */
export function isCliPath(relPath) {
  return relPath === CLI_PREFIX
    || relPath.startsWith(`${CLI_PREFIX}/`)
    || relPath.startsWith(`${CLI_PREFIX}${sep}`);
}

/**
 * Resolve an installed path back to its source file in the package.
 *
 * @param {string} relPath — path relative to .claude/
 * @param {{kitDir: string, packageRoot: string}} dirs
 * @returns {string} absolute source path
 */
export function sourceFor(relPath, { kitDir, packageRoot }) {
  return isCliPath(relPath) ? join(packageRoot, relPath) : join(kitDir, relPath);
}

/**
 * Everything the package ships into .claude/, as path → hash.
 *
 * @param {Record<string,string>} kitManifestFiles — the `files` map from kit-manifest.json
 * @param {string} packageRoot — directory holding kit/ and cli/
 * @returns {Record<string,string>} inventory covering both trees
 */
export function buildPackageInventory(kitManifestFiles, packageRoot) {
  const inventory = { ...(kitManifestFiles || {}) };
  const cliDir = join(packageRoot, CLI_PREFIX);
  if (existsSync(cliDir)) {
    for (const [rel, hash] of Object.entries(hashAllFiles(cliDir))) {
      inventory[`${CLI_PREFIX}/${rel}`] = hash;
    }
  }
  return inventory;
}
