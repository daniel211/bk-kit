/**
 * index.cjs — Steerer orchestrator.
 *
 * Combines all 4 analyzers, drafts preferences, optionally applies.
 *
 * @example
 *   const { runSteerer } = require('./index.cjs');
 *   const summary = await runSteerer({ dryRun: true });
 */

'use strict';

const path = require('path');
const { analyzeViolations } = require('./violation-analyzer.cjs');
const { analyzeDecisions } = require('./decision-reverser.cjs');
const { detectOscillations } = require('./oscillation-detector.cjs');
const { analyzeBudgets } = require('./budget-analyzer.cjs');
const { writeDraft, draftPreferences } = require('./preference-drafter.cjs');
const { mergeDraft } = require('./preference-merger.cjs');

/**
 * Resolve metrics directory from project root.
 * Tries process.env.BK_PROJECT_ROOT, then cwd traversal.
 */
function resolveMetrics(projectRoot) {
  const root = projectRoot || process.env.BK_PROJECT_ROOT || process.cwd();
  const metricsDir = path.join(root, '.bk-metrics');
  return {
    violationsFile: path.join(metricsDir, 'violations.jsonl'),
    decisionsFile: path.join(metricsDir, 'decisions.jsonl'),
    historyFile: path.join(metricsDir, 'file-edit-history.jsonl'),
    summaryFile: path.join(metricsDir, 'workflow-summary.jsonl')
  };
}

/**
 * Run the steerer pipeline.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.dryRun=false] — analyze and print, no file writes
 * @param {boolean} [opts.apply=false] — auto-apply accepted items (headless)
 * @param {string} [opts.projectRoot] — project root override
 * @param {object} [opts.policy] — harness policy (loaded from disk if not provided)
 * @returns {{
 *   candidates: object[],
 *   draftPath: string|null,
 *   written: boolean,
 *   merged: object|null,
 *   summary: string
 * }}
 */
function runSteerer(opts = {}) {
  const { dryRun = false, apply = false, projectRoot } = opts;

  // Load policy
  let policy;
  try {
    // The canonical loader lives in the hooks lib beside the siblings it requires
    // (resolve-project-root, jsonl-rotator). Its path differs per layout:
    //   installed .claude/  → ../../hooks/lib/
    //   built package       → ../../kit/hooks/lib/
    //   source tree         → ../../hooks/_base/lib/
    const LOADER_PATHS = [
      '../../hooks/lib/harness-policy-loader.cjs',
      '../../kit/hooks/lib/harness-policy-loader.cjs',
      '../../hooks/_base/lib/harness-policy-loader.cjs',
    ];
    let loadHarnessPolicy;
    for (const candidate of LOADER_PATHS) {
      try {
        ({ loadHarnessPolicy } = require(candidate));
        break;
      } catch { /* try the next layout */ }
    }
    if (!loadHarnessPolicy) throw new Error('harness policy loader not found');
    policy = loadHarnessPolicy({ projectRoot });
  } catch {
    // Fallback defaults
    policy = {
      steerer: {
        min_violation_count: 3,
        lookback_days: 30,
        draft_path: 'bk/dev/shared/.learned-preferences-draft.md',
        target_path: 'bk/dev/shared/learned-preferences.md',
        backup_dir: '.bk-metrics/learned-preferences-backups'
      }
    };
  }

  const steererConfig = policy.steerer || {};
  const root = projectRoot || process.env.BK_PROJECT_ROOT
    || (policy.__projectRoot) || process.cwd();

  const metrics = resolveMetrics(root);
  const lookbackDays = steererConfig.lookback_days || 30;
  const minCount = steererConfig.min_violation_count || 3;

  // Run all 4 analyzers
  const violationCandidates = analyzeViolations({
    violationsFile: metrics.violationsFile,
    lookbackDays,
    minCount
  });

  const decisionCandidates = analyzeDecisions({
    decisionsFile: metrics.decisionsFile,
    lookbackDays
  });

  const oscillationCandidates = detectOscillations({
    historyFile: metrics.historyFile,
    minEdits: 10,
    lookbackDays
  });

  const budgetCandidates = analyzeBudgets({
    summaryFile: metrics.summaryFile,
    lookbackDays
  });

  const candidates = [
    ...violationCandidates,
    ...decisionCandidates,
    ...oscillationCandidates,
    ...budgetCandidates
  ];

  // Build summary string
  const summaryParts = [
    `violations: ${violationCandidates.length}`,
    `decisions: ${decisionCandidates.length}`,
    `oscillations: ${oscillationCandidates.length}`,
    `budget: ${budgetCandidates.length}`
  ];
  const summary = `[steerer] Found ${candidates.length} candidate(s) — ${summaryParts.join(', ')}`;

  if (dryRun) {
    process.stdout.write(summary + '\n');
    if (candidates.length > 0) {
      process.stdout.write('[steerer] Dry-run: no files written.\n');
      process.stdout.write(draftPreferences(candidates) + '\n');
    }
    return { candidates, draftPath: null, written: false, merged: null, summary };
  }

  if (candidates.length === 0) {
    process.stdout.write('[steerer] No candidates to draft.\n');
    return { candidates, draftPath: null, written: false, merged: null, summary };
  }

  // Write draft
  const draftPath = path.isAbsolute(steererConfig.draft_path || '')
    ? steererConfig.draft_path
    : path.join(root, steererConfig.draft_path || 'bk/dev/shared/.learned-preferences-draft.md');

  const draftResult = writeDraft(candidates, draftPath);
  process.stdout.write(summary + '\n');
  process.stdout.write(`[steerer] Draft written to: ${draftPath}\n`);

  let merged = null;
  if (apply) {
    const targetPath = path.isAbsolute(steererConfig.target_path || '')
      ? steererConfig.target_path
      : path.join(root, steererConfig.target_path || 'bk/dev/shared/learned-preferences.md');
    const backupDir = path.isAbsolute(steererConfig.backup_dir || '')
      ? steererConfig.backup_dir
      : path.join(root, steererConfig.backup_dir || '.bk-metrics/learned-preferences-backups');

    merged = mergeDraft({ draftPath, targetPath, backupDir });
    if (merged.written) {
      process.stdout.write(`[steerer] Merged ${merged.accepted.length} item(s) to ${targetPath}\n`);
      if (merged.backupPath) {
        process.stdout.write(`[steerer] Backup: ${merged.backupPath}\n`);
      }
    }
  }

  return { candidates, draftPath: draftResult.written ? draftPath : null, written: draftResult.written, merged, summary };
}

module.exports = { runSteerer };
