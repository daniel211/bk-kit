'use strict';
/**
 * project-root.cjs — Resolve the project root for the bk-health CLI.
 *
 * `process.cwd()` alone is wrong: run `bk-health` from anywhere below the project root and
 * every path the CLI builds — `bk/dev/shared/.workflow-state.json` above all — points at a
 * directory that does not hold the project's state. The dashboard then reports a healthy
 * empty workflow, and `--resume` creates a second state file nobody reads. The hooks resolve
 * their root by walking up to `.claude/`; the CLI has to agree with them.
 */

const fs = require('fs');
const path = require('path');
const { requireHookLib } = require('./kit-hook-lib.cjs');

/**
 * Walk up from `start` looking for a directory containing `.claude/`.
 * @param {string} start
 * @returns {string|null}
 */
function walkUpForClaudeDir(start) {
  try {
    let dir = path.resolve(start);
    for (let i = 0; i < 20; i++) {  // safety cap against symlink loops
      if (fs.existsSync(path.join(dir, '.claude'))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) return null;  // hit filesystem root
      dir = parent;
    }
  } catch { /* unreadable path — fall through */ }
  return null;
}

/**
 * Resolve the project root the CLI should act on.
 *
 * Prefers the kit's own resolver so the CLI and the hooks can never disagree about which
 * project they are in; falls back to the same walk-up when the hooks are not installed
 * beside the CLI.
 *
 * @param {string} [explicit] - A root the caller already knows (e.g. --target)
 * @returns {string} Absolute project root
 */
function resolveCliProjectRoot(explicit) {
  if (explicit) return explicit;
  if (process.env.BK_PROJECT_ROOT && fs.existsSync(process.env.BK_PROJECT_ROOT)) {
    return process.env.BK_PROJECT_ROOT;
  }

  const lib = requireHookLib('resolve-project-root.cjs');
  if (lib && typeof lib.resolveProjectRoot === 'function') {
    try {
      return lib.resolveProjectRoot();
    } catch { /* fall through to the local walk-up */ }
  }

  return walkUpForClaudeDir(process.cwd()) || process.cwd();
}

module.exports = { resolveCliProjectRoot, walkUpForClaudeDir };
