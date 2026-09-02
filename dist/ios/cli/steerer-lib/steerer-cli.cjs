#!/usr/bin/env node
/**
 * steerer-cli.cjs — Standalone CLI for the Harness Steerer.
 *
 * Usage:
 *   node steerer-cli.cjs                — analyze + write draft
 *   node steerer-cli.cjs --dry-run      — analyze only, print to stdout
 *   node steerer-cli.cjs --apply        — write draft + auto-apply accepted items
 *   node steerer-cli.cjs --help         — show this help
 *
 * Can be run independently of bk-health/ — all dependencies are local.
 *
 * Env vars:
 *   BK_PROJECT_ROOT — project root override (for test isolation)
 *   BK_HARNESS_POLICY_PATH — harness policy override
 */

'use strict';

const { runSteerer } = require('./index.cjs');

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
steerer-cli.cjs — Harness Steerer CLI

Usage:
  node steerer-cli.cjs [options]

Options:
  --dry-run    Analyze metrics and print draft to stdout. No files written.
  --apply      Write draft AND auto-apply all items marked [x] Accept.
  --help, -h   Show this help.

Description:
  Reads .bk-metrics/violations.jsonl, decisions.jsonl, file-edit-history.jsonl,
  and workflow-summary.jsonl. Identifies:
    - Frequently violated architecture rules (>= min_violation_count)
    - Decision reversals (same scope, different choices)
    - Oscillating file edits (>= 10 edits with toggle pattern)
    - Budget overruns (> 2× estimated)

  Writes a draft to bk/dev/shared/.learned-preferences-draft.md.
  User reviews the draft, marks items [x] Accept, then runs --apply.

Env vars:
  BK_PROJECT_ROOT        Override project root
  BK_HARNESS_POLICY_PATH Override policy file path
`.trim());
  process.exit(0);
}

const dryRun = args.includes('--dry-run');
const apply = args.includes('--apply');

try {
  const result = runSteerer({ dryRun, apply });

  if (!dryRun && result.candidates.length > 0 && !apply) {
    console.log('\nReview the draft and mark items [ ] Accept, then run:');
    console.log('  node steerer-cli.cjs --apply');
  }

  if (result.merged && result.merged.written) {
    console.log(`\nMerged ${result.merged.accepted.length} accepted item(s).`);
    if (result.merged.backupPath) {
      console.log(`Backup saved: ${result.merged.backupPath}`);
    }
  }

  process.exit(0);
} catch (err) {
  process.stderr.write(`[steerer-cli] Error: ${err.message}\n`);
  if (process.env.BK_DEBUG) {
    process.stderr.write(err.stack + '\n');
  }
  process.exit(1);
}
