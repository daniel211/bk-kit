#!/usr/bin/env node
'use strict';
/**
 * hook-dispatch-runner.cjs — run several hook modules inside one process.
 *
 * Every hook in this kit is written as a standalone program: it reads stdin, does its work, and
 * calls `process.exit()` on every path (349 exit(0) and 32 exit(2) across the 50 files). Loading
 * one with a plain `require()` therefore does three unhelpful things — the first `process.exit()`
 * kills the dispatcher along with every hook queued behind it; because 45 of the 50 call `main()`
 * without awaiting it, the require returns long before the hook has finished; and a hook guarded
 * by `if (require.main === module)` does not run at all.
 *
 * The answers, in order:
 *
 *   - `loadAsMain()` gives the module the entry-point identity, so the `require.main` guard holds.
 *   - `process.exit` is patched, and the patched call IS the completion signal.
 *   - The patch throws a sentinel, because a hook that reaches `process.exit(0)` expects not to
 *     continue. Returning normally would let, say, global-kill-switch fall past its early exit for
 *     read-only tools and go on to evaluate the halt logic it meant to skip.
 *   - Everything a module writes after its own first exit is discarded. A real `process.exit()`
 *     terminates immediately, so later output is output the separate process would never have
 *     emitted — including the "CRASH (fail-open)" line each hook's outer try/catch prints when it
 *     catches the sentinel on the way out.
 *
 * Attribution is done with AsyncLocalStorage, not with a "currently running" pointer, and that is
 * load-bearing. A hook typically ends `main().catch(() => process.exit(0))`: the sentinel thrown
 * out of `main` reaches that catch one microtask AFTER the dispatcher has already moved on, so a
 * pointer would charge hook N's trailing exit to hook N+1 — settling it early and swallowing its
 * output. That was not theoretical: context-safety's trailing exit silently erased the whole of
 * parallel-safety. Under AsyncLocalStorage the store travels with the async chain that started in
 * the module, so a straggler is charged to the module it came from and, being settled already, is
 * ignored.
 *
 * The patch is installed once and never lifted between hooks, for the same reason: a live
 * `process.exit` handed back while hook 3 is still unwinding would kill hook 4.
 *
 * Ordering and isolation:
 *   - Hooks run sequentially in the order given, which is the order settings.json lists them.
 *     Sequential is not a preference — stdout, stderr and stdin are process-wide.
 *   - A hook that throws is recorded and the next hook still runs.
 *   - A hook that never signals completion hits `timeoutMs` and the dispatch moves on, so one
 *     wedged hook cannot hang the tool call.
 *   - Every hook still runs even after one exits 2, which matches today exactly: separate
 *     processes all run to completion regardless of what any other one decided.
 */

const path = require('path');
const Module = require('module');
const { AsyncLocalStorage } = require('async_hooks');

/** Carries the running hook's context through its own async continuations. */
const hookContext = new AsyncLocalStorage();

/** Set once the process-wide patches are in place; holds the current dispatch's state. */
let installed = null;

/** Thrown by the patched `process.exit` to unwind the hook that called it. */
class DispatchExit extends Error {
  constructor() {
    super('bk-dispatch: process.exit intercepted');
    this.name = 'DispatchExit';
    this.bkDispatchExit = true;
  }
}

const isDispatchExit = (err) => Boolean(err && err.bkDispatchExit);

/**
 * Load a hook the way `node hook.cjs` would, so that it believes it is the entry point.
 *
 * Not cosmetic. subagent-live-tracker.cjs ends with `if (require.main === module) { main(); }` —
 * under a plain require that guard is false, so the hook loads, does nothing, and never exits. It
 * looked like a hook that hangs; it was a hook that never ran. Any hook using that entirely
 * normal idiom would fail the same silent way.
 *
 * The module is constructed fresh rather than pulled from require.cache, so a script listed twice
 * in one group runs twice, exactly as two processes would. Its dependencies stay cached — sharing
 * lib/ across the hooks of one dispatch is much of why this is faster at all.
 */
function loadAsMain(hookPath) {
  const resolved = require.resolve(hookPath);
  delete require.cache[resolved];

  const mod = new Module(resolved, null);
  mod.filename = resolved;
  mod.paths = Module._nodeModulePaths(path.dirname(resolved));
  require.cache[resolved] = mod;

  // `require.main` inside the module is bound from process.mainModule while it loads.
  const previousMain = process.mainModule;
  process.mainModule = mod;
  try {
    mod.load(resolved);
  } finally {
    process.mainModule = previousMain;
    delete require.cache[resolved];
  }
}

/** Per-hook record produced by a dispatch. */
function newRecord(script) {
  // `exited` distinguishes a hook that really called process.exit() from one that merely stopped.
  // Every hook in this kit is supposed to exit on every path; this is what proves it.
  return { script, exitCode: null, exited: false, stdout: '', stderr: '', status: 'ok', detail: null, durationMs: 0 };
}

/**
 * Install the process-wide interception for one dispatch.
 *
 * The patches are installed once and NEVER lifted, which is the part that took a bug to learn.
 * Restoring the real `process.exit` when the loop ends is not safe: a hook ends
 * `main().catch(() => process.exit(0))`, and that catch runs one microtask after the dispatcher
 * has already moved on. Hand the real exit back and subagent-iteration-cap's trailing catch kills
 * the process mid-dispatch — every remaining hook skipped and no aggregated output written, all
 * of it looking like a hook that silently did nothing.
 *
 * So instead the patch stays and changes behaviour once `state.finished` is set: a straggler from
 * a hook is ignored (its process would already be gone), while a call with no hook context at all
 * is the dispatcher's own and goes to the real exit. Writes work the same way — no context means
 * the dispatcher is writing its aggregate, and that passes straight through.
 *
 * @param {{finished: boolean}} state — flipped by dispatch() when the last hook has settled
 */
function installProcessPatches(state) {
  // One dispatcher process normally dispatches once, but tests and tooling call dispatch() more
  // than once. Patching again would chain the patches and pile up process listeners, so later
  // calls just re-point the installed patch at the new dispatch's state.
  if (installed) {
    installed.state = state;
    return;
  }

  const realExit = process.exit.bind(process);
  const realStdoutWrite = process.stdout.write.bind(process.stdout);
  const realStderrWrite = process.stderr.write.bind(process.stderr);

  process.exit = (code) => {
    const ctx = hookContext.getStore();
    if (!ctx) return realExit(code);                  // the dispatcher itself, or a test harness
    if (installed.state.finished) return undefined;   // straggler after the dispatch closed
    ctx.exit(Number(code) || 0);
    throw new DispatchExit();
  };

  const capture = (field, realWrite) => function captured(chunk, encoding, callback) {
    const ctx = hookContext.getStore();
    if (!ctx) return realWrite(chunk, encoding, callback);
    // Output from a module that has already exited is output the separate process never produced.
    if (!ctx.settled) {
      ctx.record[field] += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    }
    if (typeof encoding === 'function') encoding();
    else if (typeof callback === 'function') callback();
    return true;
  };
  process.stdout.write = capture('stdout', realStdoutWrite);
  process.stderr.write = capture('stderr', realStderrWrite);

  const swallow = (err) => {
    if (isDispatchExit(err)) return;
    const ctx = hookContext.getStore();
    if (ctx && ctx.record.status === 'ok') {
      ctx.record.status = 'error';
      ctx.record.detail = `async: ${(err && err.message) || String(err)}`;
    }
  };
  process.on('unhandledRejection', swallow);
  process.on('uncaughtException', swallow);
  installed = { state };
}

/**
 * Run one hook module and wait for it to signal completion.
 * @returns {Promise<void>} resolves when the hook exited, threw, or timed out
 */
function runOne(hookPath, record, timeoutMs) {
  const started = Date.now();

  return new Promise((resolveOuter) => {
    let done = false;
    let timer = null;

    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      record.durationMs = Date.now() - started;
      resolveOuter();
    };

    const ctx = {
      record,
      settled: false,
      exit(code) {
        if (ctx.settled) return; // a straggler from this module's own tail — already accounted for
        ctx.settled = true;
        if (record.exitCode === null) {
          record.exitCode = code;
          record.exited = true;
        }
        finish();
      }
    };

    timer = setTimeout(() => {
      // Deliberately not unref'd: a hook that finishes with an empty event loop and never calls
      // process.exit() would otherwise let node drain and exit here, silently skipping the hooks
      // still queued behind it along with the aggregated output.
      ctx.settled = true;
      if (record.status === 'ok') {
        record.status = 'timeout';
        record.detail = `no process.exit() within ${timeoutMs}ms`;
      }
      finish();
    }, timeoutMs);

    hookContext.run(ctx, () => {
      try {
        loadAsMain(hookPath);
      } catch (err) {
        if (!isDispatchExit(err)) {
          record.status = 'error';
          record.detail = (err && err.message) || String(err);
          ctx.settled = true;
          finish();
        }
      }
    });
  });
}

/**
 * Run a list of hook modules in one process.
 *
 * @param {string[]} hookPaths — absolute paths, in settings.json order
 * @param {{ timeoutMs?: number, beforeEach?: () => void }} options
 *   `beforeEach` runs immediately before each module loads. hook-dispatch-stdin uses it to swap
 *   in an unread payload stream: a Readable is drained exactly once, so without this the second
 *   `for await (const chunk of process.stdin)` in a group reads nothing and the hook silently
 *   decides it has no event to act on.
 * @returns {Promise<Array<object>>} one record per hook, in the same order
 */
async function dispatch(hookPaths, { timeoutMs = 5000, beforeEach = null } = {}) {
  const records = hookPaths.map((p) => newRecord(path.basename(p)));
  const state = { finished: false };
  installProcessPatches(state);

  try {
    for (let i = 0; i < hookPaths.length; i++) {
      if (beforeEach) beforeEach();
      await runOne(hookPaths[i], records[i], timeoutMs);
    }
  } finally {
    state.finished = true;
  }

  for (const record of records) {
    if (record.exitCode === null) record.exitCode = 0;
  }
  return records;
}

/**
 * True when the caller belongs to a hook that has already called `process.exit()`.
 *
 * This is the same invariant the stdout/stderr capture above enforces, extended to the
 * file-backed telemetry in lib/: as separate processes, a hook is GONE the moment it exits, so
 * nothing its trailing catch block does afterwards was ever recorded. In-process it keeps
 * running, and the shape almost every hook in this kit uses turns that into self-slander:
 *
 *     try   { timer.end({ status: 'ok' }); process.exit(0); }   // throws DispatchExit
 *     catch (err) { trackViolation({ violation_type: 'internal_error', ... }); }
 *
 * The hook catches its own successful exit and files it as an internal error. In the field this
 * was not a rounding error: 1496 of 1546 recorded violations were hooks reporting DispatchExit
 * against themselves, and hook-log.jsonl carried one bogus `error` row for every `ok` row.
 *
 * Callers that write telemetry consult this and write nothing once it is true. Outside a
 * dispatch (a hook running as its own process, or a test) there is no context and it is false,
 * so standalone behaviour is untouched.
 */
function hookAlreadyExited() {
  const ctx = hookContext.getStore();
  return Boolean(ctx && ctx.settled);
}

module.exports = { dispatch, DispatchExit, isDispatchExit, hookAlreadyExited };
