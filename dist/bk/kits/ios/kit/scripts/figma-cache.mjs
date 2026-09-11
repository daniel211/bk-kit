/**
 * figma-cache.mjs — An on-disk cache for Figma REST responses, scoped to a file version.
 *
 * Why version-scoped rather than time-scoped: re-running an extraction over nineteen screens
 * refetches the same megabytes every time, and a plain TTL either serves a stale design or
 * expires while the file has not changed. Figma stamps every file with a `version` that
 * moves on each edit, so one cheap metadata call decides whether the whole cache is still
 * good. Nothing keyed to an older version is ever read.
 *
 * The cache holds design data, not secrets: the token is never part of a key or a stored
 * body. Entries live outside the repository so a cache can never be committed.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/** Entries older than this are swept even when their version still matches. */
export const MAX_ENTRY_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Where cached responses live. XDG_CACHE_HOME is honoured because that is where a cache
 * belongs on Linux, and because a test can point it somewhere disposable.
 *
 * @param {object} [env]
 * @returns {string}
 */
export function cacheRoot(env = process.env) {
  const base = env.XDG_CACHE_HOME || join(homedir(), '.cache');
  return join(base, 'beer-kit', 'figma');
}

/**
 * Name one cached response.
 *
 * The version is hashed together with the URL rather than used as a directory: an entry
 * written for version A can then never be found while version B is current, without the
 * reader having to remember to compare anything.
 *
 * @param {string} url
 * @param {string} version
 * @returns {string}
 */
export function entryName(url, version) {
  return createHash('sha256').update(`${version}\n${url}`).digest('hex').slice(0, 32) + '.json';
}

/**
 * A read-through cache for one Figma file at one version.
 *
 * Disabled — `get` always misses and `set` does nothing — when no version could be
 * established, which is what makes the caller's fallback a one-liner: a file whose version
 * cannot be read is simply fetched every time rather than risking a stale design.
 */
export class FigmaCache {
  /**
   * @param {object} opts
   * @param {string} opts.fileKey
   * @param {string|null} opts.version   null disables the cache
   * @param {string} [opts.dir]
   */
  constructor({ fileKey, version, dir }) {
    this.fileKey = fileKey;
    this.version = version ? String(version) : null;
    this.dir = dir || join(cacheRoot(), String(fileKey));
    this.enabled = Boolean(this.version);
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * @param {string} url
   * @returns {any|null} the parsed response, or null on a miss
   */
  get(url) {
    if (!this.enabled) return null;
    const path = join(this.dir, entryName(url, this.version));
    if (!existsSync(path)) {
      this.misses++;
      return null;
    }
    try {
      const entry = JSON.parse(readFileSync(path, 'utf8'));
      // A corrupt or half-written entry is a miss, not a crash: refetching is always correct.
      if (entry?.version !== this.version) {
        this.misses++;
        return null;
      }
      this.hits++;
      return entry.data;
    } catch (_) {
      this.misses++;
      return null;
    }
  }

  /**
   * @param {string} url
   * @param {any} data
   * @returns {void}
   */
  set(url, data) {
    if (!this.enabled) return;
    try {
      mkdirSync(this.dir, { recursive: true });
      const path = join(this.dir, entryName(url, this.version));
      writeFileSync(path, JSON.stringify({ url, version: this.version, savedAt: Date.now(), data }), 'utf8');
    } catch (_) {
      // A cache that cannot write is still a working client. Never fail an extraction on it.
    }
  }
}

/**
 * Delete entries older than `maxAgeMs`.
 *
 * Without this the directory grows one copy per edit of every file ever extracted, and node
 * trees are measured in megabytes. Failures are ignored for the same reason `set` ignores
 * them: housekeeping must not break an extraction.
 *
 * @param {string} [dir]
 * @param {number} [maxAgeMs]
 * @returns {number} entries removed
 */
export function sweepCache(dir = cacheRoot(), maxAgeMs = MAX_ENTRY_AGE_MS) {
  if (!existsSync(dir)) return 0;
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  const visit = (current) => {
    for (const name of readdirSync(current)) {
      const path = join(current, name);
      try {
        const stat = statSync(path);
        if (stat.isDirectory()) visit(path);
        else if (stat.mtimeMs < cutoff) { rmSync(path); removed++; }
      } catch (_) { /* vanished or unreadable — nothing to sweep */ }
    }
  };
  try { visit(dir); } catch (_) { /* unreadable root */ }
  return removed;
}
