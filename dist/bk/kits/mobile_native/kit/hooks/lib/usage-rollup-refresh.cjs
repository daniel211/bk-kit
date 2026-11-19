#!/usr/bin/env node
/**
 * usage-rollup-refresh.cjs — CLI entry for the detached usage rollup refresh
 *
 * The statusline must never scan transcripts on its render path, so when the
 * rollup goes stale it spawns this file detached and forgets about it. A lock
 * file keeps several sessions from scanning at once; a stale lock (older than
 * the timeout) is taken over rather than obeyed forever.
 *
 * Usage: node usage-rollup-refresh.cjs [resetsAtSec]
 * Always exits 0 — a failed refresh means a slightly older number, nothing more.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const LOCK_STALE_MS = 10 * 60 * 1000;

try {
  const { refreshUsageRollup, defaultPaths } = require('./usage-rollup.cjs');
  const paths = defaultPaths();
  const lockPath = `${paths.summaryPath}.lock`;

  let holdsLock = false;
  try {
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    try {
      fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
      holdsLock = true;
    } catch {
      // Someone else is scanning — unless their lock is stale.
      const age = Date.now() - fs.statSync(lockPath).mtimeMs;
      if (age > LOCK_STALE_MS) {
        fs.writeFileSync(lockPath, String(process.pid));
        holdsLock = true;
      }
    }
  } catch { /* locking is best-effort */ }

  if (holdsLock) {
    try {
      const arg = Number(process.argv[2]);
      refreshUsageRollup({ resetsAtSec: Number.isFinite(arg) && arg > 0 ? arg : null });
    } finally {
      try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
    }
  }
} catch { /* fail-open */ }

process.exit(0);
