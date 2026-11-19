/**
 * lint-worker-spawn.cjs — everything a hook needs to hand a lint batch to a detached worker.
 *
 * Three hooks spawn the worker: stop-lint-flush (end of turn), lint-findings-inject (start of
 * the next turn, which is how an INTERRUPTED turn's queue finally gets drained) and
 * session-init (adopting queues orphaned by sessions that died).
 *
 * The spawn is modelled on inferential-review.cjs's judge: detached, stdio ignored, unref'd,
 * with the child carrying its own self-kill timer. The parent never waits.
 *
 * Exports:
 *   spawnLintWorker(config)               — fire and forget, returns true when spawned
 *   computeDeferredPaths(opts)            — what the batch worker must NOT lint
 *   hasQueuedWork(projectRoot, sessionId) — cheap file-existence check
 *   adoptOrphanLintQueues(projectRoot, opts)
 *   ORPHAN_IDLE_MS
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const {
  resolveQueueFile, readQueuedFiles, sanitizeSessionId
} = require('./lint-queue.cjs');
const { NATIVE_SUPERSET_PLATFORMS, usesSameBinaryAsNative } = require('./lint-batch-runner.cjs');
const { NATIVE_QUEUE_NAMESPACE } = require('./native-lint-deferred.cjs');

const WORKER_PATH = path.join(__dirname, 'lint-flush-worker.cjs');

/**
 * How long a queue file must sit untouched before another session may adopt it.
 *
 * 5 minutes. post-edit-lint touches the queue on every single edit, so a queue whose mtime has
 * not moved in 5 minutes cannot be mid-turn. And the downside of being wrong is small by
 * construction: takeQueue claims by rename, so adopting a queue another session is also about
 * to drain means exactly one of the two wins and the other sees nothing — the batch is linted
 * once either way, and the report lands in the shared findings file either way. Contrast
 * reapStaleQueues' 24h TTL below, where being wrong DELETES the batch; that asymmetry is why
 * these two thresholds are three orders of magnitude apart.
 */
const ORPHAN_IDLE_MS = 5 * 60 * 1000;

/**
 * Spawn the detached lint worker.
 *
 * @param {{ kind: 'batch'|'native', projectRoot: string, sessionId?: string,
 *           platform?: string, lintCommand?: string, mode?: string,
 *           deferredPaths?: string[], timeoutMs?: number }} config
 * @returns {boolean} true when the child was spawned
 */
function spawnLintWorker(config) {
  if (!config || !config.projectRoot) return false;
  try {
    const arg = Buffer.from(JSON.stringify(config), 'utf8').toString('base64');
    const child = spawn(process.execPath, [WORKER_PATH, arg], {
      detached: true,
      stdio: 'ignore',
      cwd: config.projectRoot,
      env: process.env
    });
    child.unref();
    return true;
  } catch {
    return false; // fail-open: a lint flush must never break the hook that triggered it
  }
}

/**
 * Which queued paths must the batch worker leave alone because native-lint is about to analyze
 * them with the same tool?
 *
 * This is the deferral that stop-lint-flush used to do inline, unchanged in substance and
 * deliberately still computed in the PARENT. Both workers are detached, so peeking at the
 * native queue from inside the batch worker could race the native worker's rename-claim, see an
 * empty queue, and run `dart analyze` a second time over the same files — 27 runs of each hook
 * in one fusionworkomni window is what that cost before the deferral existed.
 *
 * All three gates still matter:
 *   - NATIVE_SUPERSET_PLATFORMS is flutter only. android runs different tools (ktlintCheck vs
 *     detekt) and ios loses --strict on the native side, which would downgrade its warnings.
 *   - the configured lint command must drive the same binary the native path does, or a custom
 *     command would be skipped for a run that never covers it.
 *   - if native-lint-flush is disabled nothing else lints those files at all, so deferring then
 *     loses the coverage outright rather than moving it.
 *
 * Read-only on purpose: readQueuedFiles, never takeQueue. Claiming here would starve the
 * native worker of the very batch being deferred to it.
 *
 * @param {{ projectRoot: string, sessionId?: string, platform: string, lintCommand?: string,
 *           nativeEnabled: boolean }} opts
 * @returns {string[]} absolute paths the batch worker must skip
 */
function computeDeferredPaths(opts = {}) {
  const { projectRoot, sessionId, platform, lintCommand, nativeEnabled } = opts;
  if (!projectRoot || !platform) return [];
  if (!NATIVE_SUPERSET_PLATFORMS.includes(platform)) return [];
  if (!usesSameBinaryAsNative(platform, lintCommand)) return [];
  if (!nativeEnabled) return [];
  try {
    return readQueuedFiles(resolveQueueFile(projectRoot, sessionId, NATIVE_QUEUE_NAMESPACE));
  } catch {
    return [];
  }
}

/**
 * Does this session have anything queued? A plain existsSync on two paths — about 1ms, which is
 * what makes it affordable on every UserPromptSubmit.
 *
 * @param {string} projectRoot
 * @param {string} sessionId
 * @returns {{ batch: boolean, native: boolean }}
 */
function hasQueuedWork(projectRoot, sessionId) {
  const check = (namespace) => {
    try { return fs.existsSync(resolveQueueFile(projectRoot, sessionId, namespace)); }
    catch { return false; }
  };
  return { batch: check(), native: check(NATIVE_QUEUE_NAMESPACE) };
}

/**
 * Recover a `.flushing-<pid>` claim left behind by a worker that died mid-flush.
 *
 * takeQueue renames the queue aside before reading it, so a worker killed in that window leaves
 * a claim file holding real files that were never linted — and reapStaleQueues skips anything
 * not ending in `.jsonl`, so nothing ever touched it again. Deleting it would throw the batch
 * away; instead its lines are appended back onto the live queue and the claim removed, which
 * puts those files in front of the adoption spawn below. Only done once the claim is older than
 * the idle window: a healthy claim exists for milliseconds.
 *
 * @param {string} queueDir
 * @param {string} name — the claim file's basename
 * @param {number} ageMs
 * @param {number} idleMs
 * @returns {boolean} true when lines were restored
 */
function recoverStaleClaim(queueDir, name, ageMs, idleMs) {
  if (ageMs < idleMs) return false;
  const claimPath = path.join(queueDir, name);
  const queuePath = path.join(queueDir, name.replace(/\.flushing-\d+$/, ''));
  try {
    const claimMtime = fs.statSync(claimPath).mtime;
    const hadQueue = fs.existsSync(queuePath);
    const raw = fs.readFileSync(claimPath, 'utf8');
    if (raw.trim()) fs.appendFileSync(queuePath, raw.endsWith('\n') ? raw : `${raw}\n`, 'utf8');
    fs.unlinkSync(claimPath);
    // A queue file recreated from a claim would otherwise carry mtime "now" and read as a live
    // session's, so the adoption pass right below would skip the very batch just recovered. It
    // inherits the claim's age instead. Only when we created it: an existing queue belongs to
    // whoever has been appending to it, and backdating that would invite another session to
    // adopt a live batch.
    if (!hadQueue && raw.trim()) {
      try { fs.utimesSync(queuePath, claimMtime, claimMtime); } catch { /* best effort */ }
    }
    return Boolean(raw.trim());
  } catch {
    return false;
  }
}

/**
 * Adopt lint queues left by sessions that ended without a Stop, and spawn a worker for each.
 *
 * A queue belonging to a dead session still names real files that were never linted. Reaping
 * deleted them outright; the field case is fusionworkomni's interrupted turn — last Stop
 * 02:31:44, a 10-minute turn ending in UserPromptSubmit at 02:41:46 with no Stop in between,
 * 7 .dart files queued and silently dropped 24 hours later.
 *
 * The current session's own queues are skipped: they are drained by its own Stop and by
 * lint-findings-inject, and adopting them here would duplicate that for no gain.
 *
 * @param {string} projectRoot
 * @param {{ currentSessionId?: string|null, idleMs?: number, now?: number,
 *           platform?: string, lintCommand?: string, timeoutMs?: number,
 *           nativeEnabled?: boolean, spawnFn?: Function }} opts
 * @returns {{ adopted: number, recovered: number }}
 */
function adoptOrphanLintQueues(projectRoot, opts = {}) {
  const result = { adopted: 0, recovered: 0 };
  try {
    if (!projectRoot) return result;
    const idleMs = typeof opts.idleMs === 'number' ? opts.idleMs : ORPHAN_IDLE_MS;
    const nowMs = typeof opts.now === 'number' ? opts.now : Date.now();
    const own = opts.currentSessionId ? sanitizeSessionId(opts.currentSessionId) : null;
    const doSpawn = typeof opts.spawnFn === 'function' ? opts.spawnFn : spawnLintWorker;

    const queueDir = path.join(projectRoot, '.bk-metrics', 'lint-queue');
    let entries;
    try { entries = fs.readdirSync(queueDir, { withFileTypes: true }); }
    catch { return result; }

    // Claims first, so a recovered batch is visible to the adoption pass in the same run.
    for (const entry of entries) {
      try {
        if (!entry.isFile() || !/\.flushing-\d+$/.test(entry.name)) continue;
        const ageMs = nowMs - fs.statSync(path.join(queueDir, entry.name)).mtimeMs;
        if (recoverStaleClaim(queueDir, entry.name, ageMs, idleMs)) result.recovered += 1;
      } catch { /* one bad entry must not stop the sweep */ }
    }

    for (const entry of (fs.readdirSync(queueDir, { withFileTypes: true }) || [])) {
      try {
        if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
        const base = entry.name.slice(0, -'.jsonl'.length);
        if (own && (base === own || base.startsWith(`${own}--`))) continue;

        const full = path.join(queueDir, entry.name);
        if (nowMs - fs.statSync(full).mtimeMs < idleMs) continue;  // may be a live session
        if (readQueuedFiles(full).length === 0) continue;          // nothing worth a process

        const isNative = base.endsWith(`--${NATIVE_QUEUE_NAMESPACE}`);
        const sessionId = isNative
          ? base.slice(0, -`--${NATIVE_QUEUE_NAMESPACE}`.length)
          : base;

        const spawned = doSpawn({
          kind: isNative ? 'native' : 'batch',
          projectRoot,
          sessionId,
          platform: opts.platform,
          lintCommand: opts.lintCommand,
          timeoutMs: opts.timeoutMs,
          // An orphan batch has no live native worker to defer to, so nothing is skipped. The
          // native queue of the same dead session is adopted as its own entry above/below.
          deferredPaths: [],
          // A queue orphaned hours ago routinely names files that have since been deleted;
          // linting those produces findings about work nobody is doing any more.
          skipMissing: true
        });
        if (spawned) result.adopted += 1;
      } catch { /* one bad entry must not stop the sweep */ }
    }
    return result;
  } catch {
    return result; // fail-open — adoption is recovery, never a precondition
  }
}

module.exports = {
  spawnLintWorker,
  computeDeferredPaths,
  hasQueuedWork,
  adoptOrphanLintQueues,
  recoverStaleClaim,
  ORPHAN_IDLE_MS,
  WORKER_PATH
};
