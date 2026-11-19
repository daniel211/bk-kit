/**
 * hook-exited.cjs - "Has the hook writing this already exited?" for telemetry writers.
 *
 * bk-dispatch runs a group of hooks inside one process, so a hook's `process.exit(0)` is an
 * exception (DispatchExit) rather than the end of the world. Nearly every hook here is shaped
 * `try { timer.end({status:'ok'}); process.exit(0); } catch (err) { ...log err... }`, so that
 * exception lands in the hook's own catch and gets recorded as a failure of the hook that in
 * fact just succeeded.
 *
 * Rather than patch ~190 catch blocks, the telemetry writers honour the invariant the dispatch
 * runner already applies to stdout/stderr: a hook that has exited emits nothing. Anything it
 * "writes" past that point would not exist had it been its own process, which is how these hooks
 * run whenever BK_HOOK_DISPATCH=off.
 *
 * Lazily required and fail-open: no dispatch runner in the picture (standalone hook, unit test)
 * means no suppression at all.
 */

'use strict';

function hookAlreadyExited() {
  try {
    return require('./hook-dispatch-runner.cjs').hookAlreadyExited();
  } catch (_) {
    return false;
  }
}

module.exports = { hookAlreadyExited };
