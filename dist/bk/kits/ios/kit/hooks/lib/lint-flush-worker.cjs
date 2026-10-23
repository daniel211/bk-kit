#!/usr/bin/env node
/**
 * lint-flush-worker.cjs — runs a lint batch OUT of the hook that triggered it.
 *
 * Spawned detached by stop-lint-flush, native-lint-flush and lint-findings-inject (see
 * lint-worker-spawn.cjs). The hook that spawns it exits immediately; this process claims the
 * queue, runs the linter, writes its report to lint-findings-store, and dies. The next user
 * prompt injects the report.
 *
 * Invoked as: node lint-flush-worker.cjs <base64-json-config>
 * Config: { kind: 'batch'|'native', projectRoot, sessionId, platform, lintCommand, mode,
 *           deferredPaths?: string[], timeoutMs? }
 *
 * THE WORKER CLAIMS THE QUEUE, NOT THE PARENT. takeQueue claims by rename, so exactly one
 * drainer wins and two overlapping spawns (a Stop followed straight away by the next prompt)
 * are safe by construction. Claiming in the parent and passing a file list would mean a spawn
 * that failed after the claim lost the whole batch.
 *
 * Everything fails open and always exits 0. A lint worker that throws is a lint worker whose
 * findings are gone.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { takeQueue } = require('./lint-queue.cjs');
const {
  buildBatchCommands, buildComponentBatches, baseLintCommand, runLintCommand
} = require('./lint-batch-runner.cjs');
const { isComposite, readComponents } = require('./component-resolver.cjs');
const { firstTime } = require('./advisory-once.cjs');
const { takeNativeQueue, runNativeLintBatch } = require('./native-lint-deferred.cjs');
const { appendFinding } = require('./lint-findings-store.cjs');
const { resolveQueueFile } = require('./lint-queue.cjs');

/** Same shape the Stop-time [LINT] block used — only the delivery channel changed. */
const MAX_OUTPUT_CHARS = 2000;
const MAX_NAMES_SHOWN = 8;

/**
 * Drop paths that no longer exist on disk. Only applied when the caller asks (`skipMissing`),
 * which today means the adoption path in lint-worker-spawn: a queue orphaned by a session that
 * died hours ago routinely names files that have since been deleted or renamed, and handing
 * those to the linter produces noise about work nobody is doing any more. A live session's own
 * queue is NOT filtered — a file can legitimately be absent from the filesystem check for
 * reasons the linter handles better than an existsSync does.
 */
function existingOnly(files) {
  return files.filter((f) => {
    try { return fs.existsSync(f); } catch { return false; }
  });
}

/**
 * Drain the per-file lint queue and run the platform linter once over what is left.
 * @returns {{ files: number, text: string }}
 */
function runBatch(cfg) {
  const queueFile = resolveQueueFile(cfg.projectRoot, cfg.sessionId);
  const claimed = takeQueue(queueFile);
  if (claimed.length === 0) return { files: 0, text: '' };

  // The parent computed which paths native-lint-flush is about to analyze with the same tool
  // and passed them here (see lint-worker-spawn.computeDeferredPaths). That check is read-only
  // on the native queue by design, and it has to happen in the parent: both workers are
  // detached, so a peek from in here could race the native worker's own claim and resurrect
  // the double `dart analyze` per turn this deferral exists to prevent.
  const deferred = new Set((cfg.deferredPaths || []).map((f) => path.resolve(f)));
  let files = deferred.size > 0
    ? claimed.filter((f) => !deferred.has(path.resolve(f)))
    : claimed;
  if (cfg.skipMissing) files = existingOnly(files);
  if (files.length === 0) return { files: 0, text: '' };

  const mode = cfg.mode === 'per-file' ? 'per-file' : 'auto';
  const missing = [];

  // Every kit with a readable context lints per component: own command, cwd = component root.
  // A composite kit (fullstack) has several; a single kit one, rooted at its `root` (a uv
  // backend/ → cwd backend/). No context → the build-time command at the project root.
  const composite = isComposite(cfg.platform);
  if (composite || readComponents(cfg.projectRoot)) {
    const batches = buildComponentBatches({
      projectRoot: cfg.projectRoot, files, mode, fallbackLintCommand: composite ? '' : cfg.lintCommand
    });
    let total = 0;
    let text = '';
    for (const b of batches) {
      total += b.files.length;
      const label = composite ? `${cfg.platform} ${b.id} (${b.platform})` : cfg.platform;
      text += runCommands(cfg, b.commands, b.cwd, b.files, label,
        { missing, command: baseLintCommand(b.platform, b.lintCommand), root: b.root });
    }
    reportMissingTools(cfg, missing);
    if (text) text += '[LINT] Continuing — fix lint issues before committing.\n';
    return { files: total, text };
  }

  const commands = buildBatchCommands({
    platform: cfg.platform,
    files,
    lintCommand: cfg.lintCommand,
    mode
  });
  if (commands.length === 0) return { files: files.length, text: '' };

  let text = runCommands(cfg, commands, cfg.projectRoot, files, cfg.platform,
    { missing, command: baseLintCommand(cfg.platform, cfg.lintCommand), root: '.' });
  reportMissingTools(cfg, missing);
  if (text) text += '[LINT] Continuing — fix lint issues before committing.\n';
  return { files: files.length, text };
}

/**
 * Run one batch's commands in `cwd`; the `[LINT] <label> lint warnings…` block when any failed,
 * '' when all passed. A command whose binary is missing (runLintCommand `missingTool`) is not a
 * failure: it goes to `ctx.missing` for the advisory and adds no finding.
 */
function runCommands(cfg, commands, cwd, files, label, ctx) {
  let failures = 0;
  let combined = '';
  for (const cmd of commands) {
    const result = runLintCommand(cmd, { cwd, timeoutMs: cfg.timeoutMs });
    if (result.ok) continue;
    if (result.missingTool) {
      ctx.missing.push({ command: ctx.command, root: ctx.root });
      continue;
    }
    failures += 1;
    if (result.timedOut) combined += `[LINT] timed out after ${cfg.timeoutMs}ms\n`;
    else if (result.output) combined += result.output;
  }
  if (failures === 0) return '';

  const names = files.map((f) => path.basename(f));
  const shown = names.slice(0, MAX_NAMES_SHOWN).join(', ');
  const extra = names.length > MAX_NAMES_SHOWN ? `, +${names.length - MAX_NAMES_SHOWN} more` : '';
  let text = `[LINT] ${label} lint warnings for ${files.length} file(s): ${shown}${extra}\n`;
  if (combined) text += combined.slice(0, MAX_OUTPUT_CHARS) + '\n';
  return text;
}

/**
 * One advisory per (command, root) per session (advisory-once) for a lint tool that is not
 * installed — recorded as a `lint-advisory` record, so lint-findings-inject delivers it, but it
 * is never a finding and raises no signal: a missing ruff is setup, not a lint failure.
 */
function reportMissingTools(cfg, missing) {
  const seen = new Set();
  for (const m of missing) {
    const where = !m.root || m.root === '.' ? './' : `${m.root}/`;
    const key = `lint-tool-missing|${m.command}|${where}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!firstTime(key, { sessionId: cfg.sessionId || null, feature: 'lint' })) continue;
    appendFinding(cfg.projectRoot, {
      kind: 'lint-advisory',
      session_id: cfg.sessionId || null,
      files: 0,
      text: `[LINT] lint tool not found: \`${m.command}\` in ${where} — set commands.lint in .claude/platform-context.json`
    });
  }
}

/**
 * Drain the deferred native-lint queue and run each platform's linter once over its batch.
 * @returns {Promise<{ files: number, text: string }>}
 */
async function runNative(cfg) {
  const entries = takeNativeQueue(cfg.projectRoot, cfg.sessionId);
  if (entries.length === 0) return { files: 0, text: '' };

  let nativeCfg = {};
  try {
    nativeCfg = (require('./harness-policy-loader.cjs').loadHarnessPolicy() || {}).native_lint || {};
  } catch { /* fail-open: defaults are fine */ }

  // Group by the platform each entry recorded — no re-detection from the path.
  const byPlatform = new Map();
  for (const entry of entries) {
    const platform = entry && entry.platform;
    if (!platform) continue;
    if (!byPlatform.has(platform)) byPlatform.set(platform, []);
    byPlatform.get(platform).push(entry.file);
  }

  let totalFiles = 0;
  let text = '';
  let reportedAny = false;

  for (const [platform, queued] of byPlatform) {
    const files = cfg.skipMissing ? existingOnly(queued) : queued;
    if (files.length === 0) continue;
    const result = await runNativeLintBatch({
      projectRoot: cfg.projectRoot,
      platform,
      files,
      policy: nativeCfg,
      timeoutMs: cfg.timeoutMs
    });
    totalFiles += result.files;

    if (result.timedOut) {
      text += `[NATIVE-LINT] ${platform}: timed out after ${cfg.timeoutMs}ms over ${result.files} file(s)\n`;
      reportedAny = true;
    } else if (result.findings > 0) {
      const names = files.map((f) => path.basename(f));
      const shown = names.slice(0, MAX_NAMES_SHOWN).join(', ');
      const extra = names.length > MAX_NAMES_SHOWN ? `, +${names.length - MAX_NAMES_SHOWN} more` : '';
      text += `[NATIVE-LINT] ${platform}: ${result.findings} finding(s) across ${result.filesWithFindings} file(s) — ${shown}${extra}\n`;
      // The findings themselves, not just a count. On ios/flutter the batch worker defers its
      // files here, so this is the only lint report the user sees for them.
      for (const f of result.reported || []) {
        const where = `${path.basename((f && f.file) || '')}:${(f && f.line) || 0}`;
        const sev = String((f && f.severity) || 'info').toUpperCase();
        text += `  ${sev}: ${where} [${(f && f.rule) || '?'}] ${(f && f.message) || ''}\n`;
      }
      if (result.findings > (result.reported || []).length) {
        text += `  …and ${result.findings - (result.reported || []).length} more finding(s)\n`;
      }
      reportedAny = true;
    }
  }

  if (reportedAny) text += '[NATIVE-LINT] Continuing — fix lint issues before committing.\n';
  return { files: totalFiles, text };
}

/**
 * Run one flush and record its report. Exported for tests, which drive it in-process rather
 * than chasing a detached child.
 * @param {object} cfg
 * @returns {Promise<{ files: number, text: string }>}
 */
async function runFlush(cfg) {
  const config = cfg || {};
  if (!config.projectRoot) return { files: 0, text: '' };
  const out = config.kind === 'native' ? await runNative(config) : runBatch(config);
  if (out.text) {
    appendFinding(config.projectRoot, {
      kind: config.kind === 'native' ? 'native-lint' : 'lint',
      session_id: config.sessionId || null,
      files: out.files,
      text: out.text
    });
  }
  return out;
}

if (require.main === module) {
  // Self-kill ceiling, modelled on inferential-review's detached judge: this process is
  // detached, so the hook that spawned it can never kill it. A hung `dart analyze` must not
  // outlive the session. Generous over the per-command bound because a batch may issue several
  // commands, each with its own timeout.
  const perCommandMs = parseInt(process.env.BK_LINT_TIMEOUT_MS || '60000', 10);
  const selfKill = setTimeout(() => {
    process.stderr.write('[lint-flush-worker] self-timeout reached — exiting\n');
    process.exit(0);
  }, Math.max(perCommandMs * 3, 90000));
  selfKill.unref();

  let cfg = {};
  try {
    cfg = JSON.parse(Buffer.from(process.argv[2] || '', 'base64').toString('utf8'));
  } catch { cfg = {}; }

  runFlush(cfg)
    .then(() => process.exit(0))
    .catch((e) => {
      try { process.stderr.write(`[lint-flush-worker] error: ${e.message}\n`); } catch { /* ignore */ }
      process.exit(0);
    });
}

module.exports = { runFlush, MAX_OUTPUT_CHARS, MAX_NAMES_SHOWN };
