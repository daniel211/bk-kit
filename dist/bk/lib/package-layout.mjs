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
 *
 * Since the three per-platform packages became one `@beerkit/bk`, those two trees are no longer
 * at the package root: everything platform-specific lives under `kits/<platform>/`, while bin/,
 * commands/ and lib/ are shipped once. `kitLayout()` is the only place that knows that shape, so
 * a command never spells a path like `../kit` itself.
 */

import { existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { hashAllFiles } from './hash-tracker.mjs';

/** Paths under this prefix live in the per-kit root, not in kit/. */
const CLI_PREFIX = 'cli';

/** Directory under the package root that holds one subdirectory per platform kit. */
export const KITS_DIR = 'kits';

/**
 * The package root, from a module inside commands/ or lib/.
 *
 * @param {string} moduleDir — import.meta.dirname of a commands/ or lib/ module
 * @returns {string} directory holding bin/, commands/, lib/ and kits/
 */
export function packageRootFrom(moduleDir) {
  return resolve(moduleDir, '..');
}

/**
 * Where one platform's files live inside the package.
 *
 * `packageRoot` here is the per-kit root rather than the package root, because that is the tree
 * `sourceFor` and `buildPackageInventory` mean by it: the one holding cli/ next to kit/.
 *
 * @param {string} pkgRoot — package root (see packageRootFrom)
 * @param {string} platform — "ios" | "android" | "flutter"
 * @returns {{kitRoot: string, kitDir: string, packageRoot: string, kitManifestPath: string,
 *           templatesDir: string, metaPath: string}}
 */
export function kitLayout(pkgRoot, platform) {
  const kitRoot = join(pkgRoot, KITS_DIR, platform);
  return {
    kitRoot,
    kitDir: join(kitRoot, 'kit'),
    packageRoot: kitRoot,
    kitManifestPath: join(kitRoot, 'kit-manifest.json'),
    templatesDir: join(kitRoot, 'templates'),
    metaPath: join(kitRoot, 'META.json'),
  };
}

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
