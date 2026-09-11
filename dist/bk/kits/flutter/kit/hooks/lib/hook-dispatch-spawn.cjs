#!/usr/bin/env node
'use strict';
/**
 * hook-dispatch-spawn.cjs — the BK_HOOK_DISPATCH=off runner.
 *
 * In-process dispatch changes how every hook in the kit runs, so there has to be a way to undo it
 * without a rollback. There are two, at different depths:
 *
 *   - `BK_HOOK_DISPATCH=off ./build.sh` emits the pre-dispatcher settings.json — one `node`
 *     command per hook, exactly as before. That is the full escape hatch.
 *   - `BK_HOOK_DISPATCH=off` in the environment of an already-installed kit makes this module run
 *     instead, spawning each hook as its own process, in parallel, each with its own copy of the
 *     payload on stdin. That restores per-hook process isolation — the property most likely to be
 *     the cause if something goes wrong — without touching settings.json.
 *
 * The second one still funnels output through one process, so it is a diagnostic, not a perfect
 * replica. When in doubt, rebuild with the env var set.
 */

const path = require('path');
const { spawn } = require('child_process');

/**
 * @param {string[]} hookPaths — absolute paths, in settings.json order
 * @param {string} payload — raw event payload for each hook's stdin
 * @returns {Promise<Array<object>>} records in the same shape the in-process runner produces
 */
function dispatchViaSpawn(hookPaths, payload, { timeoutMs = 5000 } = {}) {
  return Promise.all(hookPaths.map((hookPath) => runChild(hookPath, payload, timeoutMs)));
}

function runChild(hookPath, payload, timeoutMs) {
  return new Promise((resolve) => {
    const record = { script: path.basename(hookPath), exitCode: 0, exited: true, stdout: '', stderr: '', status: 'ok', detail: null, durationMs: 0 };
    const started = Date.now();
    let child;

    try {
      child = spawn(process.execPath, [hookPath], { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      record.status = 'error';
      record.detail = err.message;
      return resolve(record);
    }

    const timer = setTimeout(() => {
      record.status = 'timeout';
      record.detail = `exceeded ${timeoutMs}ms`;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (chunk) => { record.stdout += chunk; });
    child.stderr.on('data', (chunk) => { record.stderr += chunk; });
    child.on('error', (err) => {
      if (record.status === 'ok') { record.status = 'error'; record.detail = err.message; }
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      record.exitCode = Number(code) || 0;
      record.durationMs = Date.now() - started;
      resolve(record);
    });

    try {
      child.stdin.end(payload);
    } catch { /* the child may already be gone; close still fires */ }
  });
}

module.exports = { dispatchViaSpawn };
