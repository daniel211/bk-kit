/**
 * resolve-project-root.cjs - Single source of truth for project root resolution
 *
 * Hooks live at {project_root}/.claude/hooks/xxx.cjs
 * This utility resolves the project root using a reliable fallback chain:
 *   1. hookData.cwd (passed by Claude Code runtime via stdin JSON)
 *   2. __dirname-based (walk up from .claude/hooks/lib/ → project root)
 *   3. process.cwd() (last resort)
 */

'use strict';

const path = require('path');
const fs = require('fs');

/** Cache to avoid repeated fs checks within the same hook execution */
let _cachedRoot = null;

/**
 * Markers that distinguish a real project root from any directory that merely
 * contains a `.claude/` folder.
 */
const PROJECT_MARKERS = ['.git', path.join('.claude', '.bk.json'), 'bk'];

/**
 * A candidate qualifies as a project root only if it has `.claude/` AND at least
 * one project marker.
 *
 * `.claude/` alone is not enough, for two reasons both seen in the field:
 *
 *  - `~/.claude` exists on every machine with Claude Code installed, so a
 *    CLAUDE_PROJECT_DIR left pointing at $HOME was accepted and every hook then
 *    read the wrong root.
 *
 *  - Agents create stray `.claude/` directories by accident. Resolving their memory
 *    path against the working directory instead of the project root produces
 *    `<feature-dir>/.claude/agent-memory/<agent>/`, and six different agents did
 *    exactly that in one project. agent-memory-path-guard blocks the write, but the
 *    directory is already there — and from then on the feature directory resolved as
 *    the project root, so `.bk-metrics/`, the workflow state and the harness policy
 *    would all have been read and written in the wrong place.
 *
 * @param {string} dir
 * @returns {boolean}
 */
function looksLikeProject(dir) {
  try {
    if (!fs.existsSync(path.join(dir, '.claude'))) return false;
    return PROJECT_MARKERS.some((m) => fs.existsSync(path.join(dir, m)));
  } catch {
    return false;
  }
}

/**
 * Resolve project root from __dirname.
 * This file lives at {root}/.claude/hooks/lib/resolve-project-root.cjs
 * So project root = __dirname/../../..
 * @returns {string|null}
 */
function resolveFromDirname() {
  const candidate = path.resolve(__dirname, '..', '..', '..');
  try {
    if (looksLikeProject(candidate)) {
      return candidate;
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Resolve the project root directory.
 *
 * @param {Object} [hookData] - Hook input data (parsed from stdin JSON)
 * @param {string} [hookData.cwd] - CWD provided by Claude Code runtime
 * @returns {string} Absolute path to project root
 */
function resolveProjectRoot(hookData) {
  if (_cachedRoot) return _cachedRoot;

  // Priority 0: BK_PROJECT_ROOT env var (for test environments and explicit overrides)
  if (process.env.BK_PROJECT_ROOT) {
    const envRoot = process.env.BK_PROJECT_ROOT;
    if (fs.existsSync(envRoot)) {
      _cachedRoot = envRoot;
      return _cachedRoot;
    }
  }

  // Priority 1: CLAUDE_PROJECT_DIR env var (injected by Claude Code runtime).
  // This is authoritative: it's the project directory the user opened in Claude,
  // regardless of where the hook is currently executing from.
  if (process.env.CLAUDE_PROJECT_DIR) {
    const claudeRoot = process.env.CLAUDE_PROJECT_DIR;
    if (looksLikeProject(claudeRoot)) {
      _cachedRoot = claudeRoot;
      return _cachedRoot;
    }
  }

  // Priority 2: hookData.cwd from Claude Code runtime stdin payload
  if (hookData && hookData.cwd && typeof hookData.cwd === 'string') {
    if (looksLikeProject(hookData.cwd)) {
      _cachedRoot = hookData.cwd;
      return _cachedRoot;
    }
  }

  // Priority 3: __dirname-based resolution
  const fromDirname = resolveFromDirname();
  if (fromDirname) {
    _cachedRoot = fromDirname;
    return _cachedRoot;
  }

  // Priority 4: walk up from process.cwd() looking for a .claude directory.
  // Handles the case where the user is in a subfolder (e.g. bk/dev/xxx).
  const cwdRoot = resolveByWalkingUp(process.cwd());
  if (cwdRoot) {
    _cachedRoot = cwdRoot;
    return _cachedRoot;
  }

  // Priority 5: process.cwd() fallback (last resort, may not be a kit project)
  _cachedRoot = process.cwd();
  return _cachedRoot;
}

/**
 * Walk up from `start` until we find a directory containing `.claude/`.
 * Stops at filesystem root. Returns null if not found.
 * @param {string} start
 * @returns {string|null}
 */
function resolveByWalkingUp(start) {
  try {
    let dir = path.resolve(start);
    for (let i = 0; i < 20; i++) {  // safety cap against symlink loops
      if (looksLikeProject(dir)) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) return null;  // hit filesystem root
      dir = parent;
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Clear the cached root (useful for testing or when hooks chain)
 */
function clearCache() {
  _cachedRoot = null;
}

module.exports = { resolveProjectRoot, clearCache };
