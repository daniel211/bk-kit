/**
 * telemetry-gitignore.mjs — Keep exported telemetry bundles out of the project's git history.
 *
 * Separate from NEVER_COMMIT in session-state-gitignore.mjs: that list is what `init` and
 * `update` enforce on every project, while a bundle exists only if the user ran `bk telemetry`,
 * so the entry is offered at that moment rather than written everywhere.
 */

import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join, relative, isAbsolute } from 'node:path';
import { spawnSync } from 'node:child_process';
import { gitPrefix } from './session-state-gitignore.mjs';

export const BUNDLE_PATTERN = 'bk-telemetry-*.tgz';

/**
 * Does the bundle at `file` need an ignore entry?
 *
 * False outside the project or outside a git work tree, where a .gitignore line does nothing,
 * and false when any rule (a global excludes file too) already covers it.
 *
 * @param {string} root — project root
 * @param {string} file — absolute bundle path
 * @returns {boolean}
 */
export function bundleNeedsIgnore(root, file) {
  const rel = relative(root, file);
  if (rel.startsWith('..') || isAbsolute(rel)) return false;
  if (gitPrefix(dirname(file)) === null) return false;
  const r = spawnSync('git', ['check-ignore', '-q', '--no-index', '--', file], {
    cwd: dirname(file), windowsHide: true, timeout: 10000,
  });
  return r.status === 1;
}

/**
 * Add the bundle pattern to .gitignore. Appends only when absent and leaves the rest as it is.
 *
 * @param {string} root
 * @returns {boolean} true when a line was written
 */
export function addBundleIgnore(root) {
  const path = join(root, '.gitignore');
  let text = '';
  try { text = readFileSync(path, 'utf8'); } catch { /* No .gitignore yet: appendFileSync creates it. */ }
  if (text.split('\n').some((l) => l.trim() === BUNDLE_PATTERN)) return false;
  const prefix = text.length === 0 || text.endsWith('\n') ? '' : '\n';
  appendFileSync(path, `${prefix}${BUNDLE_PATTERN}\n`, 'utf8');
  return true;
}
