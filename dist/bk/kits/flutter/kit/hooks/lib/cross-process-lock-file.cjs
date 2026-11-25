/**
 * cross-process-lock-file.cjs — a `wx` lock file shared by every hook process in a repo.
 *
 * Extracted from bk-config-utils.cjs (writeWorkflowState's lock) when workflow-summary.cjs
 * needed the same guard. Hooks run as separate node processes, often at the same instant —
 * SubagentStop fires once per parallel agent, and SessionEnd fires once per session when the
 * app quits — so an in-process mutex protects nothing. X-Game-Pro on 0.19.0: five sessions
 * ended together at 2026-11-23T13:11:26 and each appended the same
 * `bk-code:partner-place-category` summary row, because all five read workflow-summary.jsonl
 * before any of them wrote it.
 *
 * Mechanism: `fs.writeFileSync(lockPath, token, { flag: 'wx' })` is an atomic create, so under
 * a race exactly one process gets the lock and the rest wait in small synchronous sleeps.
 * A lock older than `staleMs` belonged to a process that died holding it and is broken.
 *
 * KNOWN LIMIT of the stale takeover: two waiters that both see the same stale lock can both
 * unlink — the second unlink may remove the first waiter's fresh lock — and then both hold
 * it. That needs a crashed holder AND two waiters inside one retry tick; the result is the
 * pre-lock behaviour for that one round, not a hang. Accepted rather than adding a second
 * protocol for a case that has never shown up in the field.
 *
 * Synchronous on purpose: hooks are CJS scripts with no event loop worth awaiting on.
 */

'use strict';

const fs = require('fs');

/** Block the thread for `ms` without burning CPU. */
function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const until = Date.now() + ms;
    while (Date.now() < until) { /* SharedArrayBuffer unavailable — spin */ }
  }
}

/**
 * Take the lock, waiting for a live holder and breaking an abandoned one.
 *
 * Every branch falls through to the deadline check: a lock directory that cannot be written
 * to (missing, read-only) must end as a refused lock, never as a spin.
 *
 * @param {string} lockPath
 * @param {{ timeoutMs: number, staleMs: number, retryMs?: number }} opts
 * @returns {string|null} the token this process wrote (pass it to releaseLockFile), or null
 *   when the lock could not be taken before the deadline
 */
function acquireLockFile(lockPath, { timeoutMs, staleMs, retryMs = 25 }) {
  // pid alone is not unique enough to recognise our own lock on release: a reused pid after a
  // crash would match. The random suffix makes the token this acquisition's alone.
  const token = `${process.pid}:${Math.random().toString(36).slice(2)}`;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      fs.writeFileSync(lockPath, token, { flag: 'wx' });
      return token;
    } catch { /* held by someone else, or unwritable — inspect it below */ }

    try {
      if (Date.now() - fs.statSync(lockPath).mtimeMs > staleMs) {
        // Break it and retry the create at once; the `wx` create still decides who wins.
        // A failing unlink (read-only dir, or another waiter broke it first) throws past the
        // `continue` into the deadline check, so it can never spin.
        fs.unlinkSync(lockPath);
        continue;
      }
    } catch { /* no lock file, or the unlink failed — retry until the deadline */ }

    if (Date.now() >= deadline) return null;
    sleepSync(retryMs);
  }
}

/**
 * Release a lock taken by acquireLockFile. Only removes the file while it still carries our
 * token: if this holder overran `staleMs` and another process broke and re-took the lock,
 * deleting it would hand the critical section to a third process while the second is in it.
 *
 * @param {string} lockPath
 * @param {string|null} token — acquireLockFile's return value; null is a no-op
 */
function releaseLockFile(lockPath, token) {
  if (!token) return;
  try {
    if (fs.readFileSync(lockPath, 'utf8') === token) fs.unlinkSync(lockPath);
  } catch { /* already gone */ }
}

module.exports = { acquireLockFile, releaseLockFile, sleepSync };
