/**
 * parallel-lock-registry.cjs — Central lock registry for parallel-safety hook (P1-1).
 *
 * Stores per-file lock claims trong `.bk-metrics/parallel-locks/` (one JSON file per file path).
 * Provides explicit acquisition + release API so locks are reclaimed on SubagentStop instead
 * of relying solely on TTL expiry.
 *
 * Lock file format: { file, agent, mode: 'read'|'write', timestamp }
 *
 * Exports:
 *   getLockDir()
 *   acquireLock(file, agent, mode)         → boolean (false if would conflict, but writes anyway — caller decides)
 *   readActiveLocks(staleMs)               → { filePath: lockData }
 *   writeLock(file, agent, mode)
 *   releaseLocksForAgent(agent)            → number (count released)
 *   releaseStaleLocks(staleMs)             → number (count released)
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_STALE_MS = 600000; // 10 minutes

/**
 * Resolve the lock directory path. Uses harness-policy-loader's
 * .bk-metrics convention via resolveMetricPath when available.
 */
function getLockDir(projectRoot) {
  try {
    const { resolveMetricPath } = require('./harness-policy-loader.cjs');
    return resolveMetricPath('parallel-locks', projectRoot);
  } catch {
    // Fallback: walk up from cwd to find project root, default to cwd otherwise
    const root = projectRoot || process.env.BK_PROJECT_ROOT || process.cwd();
    return path.join(root, '.bk-metrics', 'parallel-locks');
  }
}

function lockFilenameForPath(filePath) {
  // Filesystem-safe deterministic id (truncated to keep filename length sane)
  return filePath.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 100) + '.lock';
}

/**
 * Read all active locks, expiring stale ones older than staleMs.
 * @returns {Object<string, {file:string, agent:string, mode:string, timestamp:number}>}
 */
function readActiveLocks(staleMs = DEFAULT_STALE_MS, projectRoot) {
  const locks = {};
  const dir = getLockDir(projectRoot);
  try {
    if (!fs.existsSync(dir)) return locks;
    const entries = fs.readdirSync(dir);
    const now = Date.now();
    for (const entry of entries) {
      const lockPath = path.join(dir, entry);
      try {
        const content = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
        if (now - content.timestamp > staleMs) {
          try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
          continue;
        }
        if (content.file) locks[content.file] = content;
      } catch { /* skip corrupt */ }
    }
  } catch { /* unreadable dir */ }
  return locks;
}

function writeLock(file, agent, mode, projectRoot) {
  const dir = getLockDir(projectRoot);
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const lockPath = path.join(dir, lockFilenameForPath(file));
    fs.writeFileSync(lockPath, JSON.stringify({
      file, agent, mode, timestamp: Date.now()
    }), 'utf8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Release all locks owned by a specific agent (called on SubagentStop).
 * @returns {number} count of locks released
 */
function releaseLocksForAgent(agent, projectRoot) {
  if (!agent) return 0;
  const dir = getLockDir(projectRoot);
  let released = 0;
  try {
    if (!fs.existsSync(dir)) return 0;
    const entries = fs.readdirSync(dir);
    for (const entry of entries) {
      const lockPath = path.join(dir, entry);
      try {
        const content = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
        if (content.agent === agent) {
          fs.unlinkSync(lockPath);
          released++;
        }
      } catch { /* skip */ }
    }
  } catch { /* fail-open */ }
  return released;
}

function releaseStaleLocks(staleMs = DEFAULT_STALE_MS, projectRoot) {
  const dir = getLockDir(projectRoot);
  let released = 0;
  try {
    if (!fs.existsSync(dir)) return 0;
    const entries = fs.readdirSync(dir);
    const now = Date.now();
    for (const entry of entries) {
      const lockPath = path.join(dir, entry);
      try {
        const content = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
        if (now - content.timestamp > staleMs) {
          fs.unlinkSync(lockPath);
          released++;
        }
      } catch { /* skip */ }
    }
  } catch { /* fail-open */ }
  return released;
}

module.exports = {
  getLockDir,
  readActiveLocks,
  writeLock,
  releaseLocksForAgent,
  releaseStaleLocks
};
