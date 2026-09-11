#!/usr/bin/env node
'use strict';
/**
 * hook-dispatch-stdin.cjs — give every dispatched hook module its own copy of the payload.
 *
 * A hook process gets the event payload on fd 0. Run twenty hooks in one process and only the
 * first read wins: a pipe is drained once. The kit's hooks read stdin two different ways, and
 * both have to be intercepted or the second hook in a dispatch silently sees `{}`:
 *
 *   1. `for await (const chunk of process.stdin)` — 27 hooks. Needs a fresh Readable per module.
 *   2. `fs.readFileSync(0, 'utf8')`               — 21 hooks. Needs `fs` itself patched, because
 *      the fd is read directly and `process.stdin` is never touched.
 *
 * Both patches are installed once for the life of the dispatcher and never removed. Restoring
 * them between hooks would be wrong: 45 of the 50 hooks are async, so a hook can still be
 * unwinding when the next one starts, and a late read must not hit the real (already drained)
 * fd 0.
 */

const fs = require('fs');
const { Readable } = require('stream');

/** fd 0 and the two path spellings that mean the same thing. */
function isStdinTarget(target) {
  return target === 0 || target === '/dev/stdin' || target === '/proc/self/fd/0';
}

/**
 * Read the whole event payload before any hook runs.
 *
 * Synchronous on purpose: it must complete before the first module is required, so that no hook
 * can race ahead and drain the pipe itself.
 *
 * @returns {string} raw payload, or '' when nothing was piped in
 */
function readPayload() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Install the two interceptions.
 *
 * @param {string} payload — the raw event payload every hook should see
 * @returns {{ freshStream: () => void, restore: () => void }}
 *   `freshStream()` swaps in an unread stream — call it before each hook module.
 */
function installStdin(payload) {
  const originalReadFileSync = fs.readFileSync;
  const originalDescriptor = Object.getOwnPropertyDescriptor(process, 'stdin');

  fs.readFileSync = function readFileSyncIntercepted(target, options) {
    if (!isStdinTarget(target)) return originalReadFileSync.apply(fs, arguments);
    const encoding = typeof options === 'string' ? options : options && options.encoding;
    return encoding ? payload : Buffer.from(payload, 'utf8');
  };

  let current = Readable.from([payload]);
  Object.defineProperty(process, 'stdin', {
    configurable: true,
    get: () => current
  });

  return {
    freshStream() {
      current = Readable.from([payload]);
    },
    restore() {
      fs.readFileSync = originalReadFileSync;
      if (originalDescriptor) Object.defineProperty(process, 'stdin', originalDescriptor);
    }
  };
}

module.exports = { readPayload, installStdin, isStdinTarget };
