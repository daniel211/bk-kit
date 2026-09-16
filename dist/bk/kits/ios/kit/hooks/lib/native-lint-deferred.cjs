/**
 * native-lint-deferred.cjs — defer the native lint off PostToolUse and onto Stop.
 *
 * Why: arch-fitness-<platform>-native.cjs ran the real linter inline on every
 * Edit/Write. One day in the field (fusionworkomni, flutter kit): 84 runs,
 * 1076ms average, 90.4s total — 97% of all PostToolUse hook time — and 4 runs
 * killed by bk-dispatch at exactly 5000/5001/5002ms, their findings lost with no
 * trace because the hook thought its budget was 30000ms. The same `dart analyze`
 * was then run AGAIN at Stop by stop-lint-flush.
 *
 * So when the platform is not configured to BLOCK on lint errors (the shipped
 * default, `block_on_error: false`), the PostToolUse hook only records the path
 * here and gets out of the way. native-lint-flush.cjs (Stop) drains this queue and
 * runs the linter once over the whole batch, emitting the same per-file findings
 * and signals the inline path used to emit.
 *
 * Queue file: .bk-metrics/lint-queue/<session>--native.jsonl — deliberately NOT
 * the file stop-lint-flush drains. takeQueue claims by rename, so two drainers on
 * one file means one of them silently loses a whole batch.
 *
 * Every function fails open. No lint bookkeeping may block a tool call.
 *
 * Exports:
 *   NATIVE_QUEUE_NAMESPACE, MAX_BATCH_FILES, MAX_REPORTED_FINDINGS
 *   resolveNativeQueueFile(projectRoot, sessionId)
 *   enqueueNative(projectRoot, sessionId, platform, absFile)
 *   takeNativeQueue(projectRoot, sessionId)
 *   runNativeLintBatch({ projectRoot, platform, files, policy, timeoutMs })
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const { resolveQueueFile, enqueueFile, takeQueueEntries } = require('./lint-queue.cjs');
const { runTool } = require('./native-lint-runner.cjs');
const { trackRedSignal, trackWarnSignal, resolveMetricPath } = require('./harness-policy-loader.cjs');
const { appendJsonl: rotatorAppend } = require('./jsonl-rotator.cjs');

/** Distinct from stop-lint-flush's queue — see the header. */
const NATIVE_QUEUE_NAMESPACE = 'native';

/** Upper bound on one batched run. Beyond this the batch is marked truncated. */
const MAX_BATCH_FILES = 50;

/**
 * How many individual findings runNativeLintBatch hands back for printing.
 *
 * The Stop-time [NATIVE-LINT] line is now the ONLY human-readable report for a
 * file that stop-lint-flush deferred here (see NATIVE_SUPERSET_PLATFORMS in
 * lint-batch-runner.cjs), so a bare count would leave the user with less than the
 * [LINT] block used to give them. 20 is the same order as the 2000-char cap the
 * [LINT] path truncated its raw linter output to.
 */
const MAX_REPORTED_FINDINGS = 20;

/**
 * Queue file for one session's deferred native lint.
 * @param {string} projectRoot
 * @param {string} sessionId
 * @returns {string}
 */
function resolveNativeQueueFile(projectRoot, sessionId) {
  return resolveQueueFile(projectRoot, sessionId, NATIVE_QUEUE_NAMESPACE);
}

/**
 * Record one edited file for the end-of-turn native lint.
 * The platform rides along on the entry so the Stop-side flush never has to
 * re-detect it from the path.
 *
 * @param {string} projectRoot
 * @param {string} sessionId
 * @param {'ios'|'android'|'flutter'} platform
 * @param {string} absFile
 * @returns {boolean} true when the line was written
 */
function enqueueNative(projectRoot, sessionId, platform, absFile) {
  if (!projectRoot || !platform || !absFile) return false;
  try {
    return enqueueFile(resolveNativeQueueFile(projectRoot, sessionId), absFile, { platform });
  } catch {
    return false;
  }
}

/**
 * Claim the whole native queue atomically (rename-then-read).
 * @param {string} projectRoot
 * @param {string} sessionId
 * @returns {{ ts: number, file: string, platform: string }[]} deduped entries
 */
function takeNativeQueue(projectRoot, sessionId) {
  if (!projectRoot) return [];
  try {
    return takeQueueEntries(resolveNativeQueueFile(projectRoot, sessionId));
  } catch {
    return [];
  }
}

/**
 * Append one findings record, in the exact shape the inline hook wrote.
 * @param {string} platform
 * @param {object[]} findings
 * @param {string} filePath
 * @param {string} projectRoot
 */
function writeFindings(platform, findings, filePath, projectRoot) {
  try {
    const jsonlPath = resolveMetricPath(`.bk-metrics/native-lint-${platform}.jsonl`, projectRoot);
    const dir = path.dirname(jsonlPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const record = {
      ts:       Date.now(),
      hook:     `arch-fitness-${platform}-native`,
      file:     filePath,
      findings: findings.slice(0, 200),
      deferred: true
    };
    rotatorAppend(jsonlPath, JSON.stringify(record) + '\n');
  } catch { /* fail-open */ }
}

/**
 * Group parsed findings by the file the tool attributed them to.
 * @param {object[]} findings
 * @returns {Map<string, object[]>}
 */
function groupByFile(findings) {
  const byFile = new Map();
  for (const f of findings) {
    const key = (f && f.file) || '';
    if (!key) continue;
    if (!byFile.has(key)) byFile.set(key, []);
    byFile.get(key).push(f);
  }
  return byFile;
}

/**
 * Lint a whole batch in ONE tool run, then emit per-file findings and signals.
 *
 * Per-file, not aggregate, on purpose: the kill switch weighs entries in
 * red-signals.jsonl and the statusline counts them, so one signal covering nine
 * files would under-count by eight against every existing threshold.
 *
 * @param {{ projectRoot: string, platform: string, files: string[], policy?: object, timeoutMs?: number }} opts
 * @returns {Promise<{ ran: boolean, files: number, findings: number, filesWithFindings: number,
 *                     red: number, yellow: number, truncated: boolean, timedOut: boolean,
 *                     durationMs: number, reported: object[] }>}
 *          `reported` is up to MAX_REPORTED_FINDINGS findings, for the caller to print.
 */
async function runNativeLintBatch(opts = {}) {
  const { projectRoot, platform, policy = {}, timeoutMs } = opts;
  const queued = Array.isArray(opts.files) ? opts.files.filter(Boolean) : [];
  const empty = {
    ran: false, files: 0, findings: 0, filesWithFindings: 0,
    red: 0, yellow: 0, truncated: false, timedOut: false, durationMs: 0, reported: []
  };
  if (!platform || queued.length === 0) return empty;

  const batch = queued.slice(0, MAX_BATCH_FILES);
  const overflowed = queued.length > MAX_BATCH_FILES;
  const signalType = `native_lint_${platform}`;

  let result;
  try {
    result = await runTool(platform, batch, { timeoutMs, policy });
  } catch {
    return { ...empty, files: batch.length, truncated: overflowed };
  }

  const { exitCode, findings = [], durationMs = 0 } = result;
  const truncated = Boolean(result.truncated) || overflowed;

  // A timeout is recorded, not swallowed. Losing it silently is the other half of
  // the field bug: 4 killed runs left nothing behind at all.
  if (exitCode === 124) {
    try {
      trackWarnSignal(signalType, {
        file: batch[0] || null, files: batch.length, errors: 0, warnings: 0,
        durationMs, truncated, timedOut: true
      });
    } catch { /* fail-open */ }
    return { ...empty, ran: true, files: batch.length, truncated, timedOut: true, durationMs, yellow: 1 };
  }

  const redOnErrorOnly = policy.red_on_error_only !== false;
  const byFile = groupByFile(findings);
  let red = 0;
  let yellow = 0;

  for (const [file, fileFindings] of byFile) {
    writeFindings(platform, fileFindings, file, projectRoot);

    const errors   = fileFindings.filter((f) => f.severity === 'error').length;
    const warnings = fileFindings.filter((f) => f.severity === 'warning').length;
    const signalMeta = { file, errors, warnings, durationMs, truncated };

    try {
      if (!redOnErrorOnly || errors > 0) {
        trackRedSignal(signalType, signalMeta);
        red += 1;
      } else {
        trackWarnSignal(signalType, signalMeta);
        yellow += 1;
      }
    } catch { /* fail-open */ }
  }

  return {
    ran: true,
    files: batch.length,
    findings: findings.length,
    filesWithFindings: byFile.size,
    red,
    yellow,
    truncated,
    timedOut: false,
    durationMs,
    reported: findings.slice(0, MAX_REPORTED_FINDINGS)
  };
}

module.exports = {
  NATIVE_QUEUE_NAMESPACE,
  MAX_BATCH_FILES,
  MAX_REPORTED_FINDINGS,
  resolveNativeQueueFile,
  enqueueNative,
  takeNativeQueue,
  runNativeLintBatch
};
