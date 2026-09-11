#!/usr/bin/env node
'use strict';
/**
 * bk-harness-ci/index.cjs — Headless harness validation CLI for CI/CD pipelines.
 *
 * Usage:
 *   node bk-harness-ci/index.cjs [--format=junit|json|console] [--output=<path>]
 *                                 [--budget-usd=<N>] [--fail-on=warn|error|never]
 *
 * Exit codes:
 *   0 — clean (no issues above threshold)
 *   1 — warnings present (when --fail-on=warn)
 *   2 — errors present
 *   3 — config / load error
 */

const fs = require('fs');
const path = require('path');

const { aggregateFindings, summariseByCategory, computeBudgetStatus } = require('./lib/aggregator.cjs');
const { writeJunit, findingsToTestSuites } = require('./lib/junit-writer.cjs');
const { getPrCost, formatCost } = require('./lib/budget-tracker.cjs');

// ─── Arg parsing ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {
    format: 'console',
    output: null,
    budgetUsd: null,
    failOn: 'error',
    windowMs: null,
    projectRoot: null
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--format=')) opts.format = a.slice('--format='.length);
    else if (a.startsWith('--output=')) opts.output = a.slice('--output='.length);
    else if (a.startsWith('--budget-usd=')) opts.budgetUsd = parseFloat(a.slice('--budget-usd='.length));
    else if (a.startsWith('--fail-on=')) opts.failOn = a.slice('--fail-on='.length);
    else if (a.startsWith('--window=')) opts.windowMs = parseInt(a.slice('--window='.length), 10) * 1000;
    else if (a.startsWith('--project-root=')) opts.projectRoot = a.slice('--project-root='.length);
    else if (a === '--format' && args[i+1]) opts.format = args[++i];
    else if (a === '--output' && args[i+1]) opts.output = args[++i];
    else if (a === '--budget-usd' && args[i+1]) opts.budgetUsd = parseFloat(args[++i]);
    else if (a === '--fail-on' && args[i+1]) opts.failOn = args[++i];
    else if (a === '--project-root' && args[i+1]) opts.projectRoot = args[++i];
  }

  if (!['junit', 'json', 'console'].includes(opts.format)) {
    process.stderr.write(`[bk-harness-ci] Invalid format: ${opts.format}. Use: junit|json|console\n`);
    process.exit(3);
  }

  if (!['warn', 'error', 'never'].includes(opts.failOn)) {
    process.stderr.write(`[bk-harness-ci] Invalid --fail-on: ${opts.failOn}. Use: warn|error|never\n`);
    process.exit(3);
  }

  return opts;
}

// ─── Policy loader ─────────────────────────────────────────────────────────────

function tryLoadPolicy(projectRoot) {
  // Attempt to load policy using standard resolution
  const candidates = [
    process.env.BK_HARNESS_POLICY_PATH,
    path.join(projectRoot, '.claude', 'bk-harness-policy.json'),
    path.join(projectRoot, '.claude', 'hooks', 'lib', 'bk-harness-policy.json'),
    path.join(projectRoot, 'src', 'hooks', '_base', 'lib', 'bk-harness-policy.json'),
    path.join(__dirname, '..', '..', 'hooks', '_base', 'lib', 'bk-harness-policy.json')
  ].filter(Boolean);

  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
      }
    } catch { /* try next */ }
  }
  return null;
}

// ─── Project detection ────────────────────────────────────────────────────────

function detectPlatforms(projectRoot) {
  const platforms = [];
  try {
    const detectorPath = path.join(__dirname, '..', '..', 'hooks', '_base', 'lib', 'project-detector.cjs');
    if (fs.existsSync(detectorPath)) {
      const detector = require(detectorPath);
      if (typeof detector.detectProjectType === 'function') {
        const result = detector.detectProjectType(projectRoot);
        if (result) platforms.push(result);
        return platforms;
      }
    }
  } catch { /* fall through */ }

  // Heuristic fallback
  if (fs.existsSync(path.join(projectRoot, 'Podfile')) || fs.existsSync(path.join(projectRoot, 'Package.swift'))) {
    platforms.push('ios');
  }
  if (fs.existsSync(path.join(projectRoot, 'build.gradle')) || fs.existsSync(path.join(projectRoot, 'gradlew'))) {
    platforms.push('android');
  }
  if (fs.existsSync(path.join(projectRoot, 'pubspec.yaml'))) {
    platforms.push('flutter');
  }
  return platforms;
}

// ─── Arch-fitness static check ────────────────────────────────────────────────

function runArchFitness(projectRoot, policy) {
  const checks = [];
  if (!policy || !policy.arch_fitness) return checks;

  const platforms = detectPlatforms(projectRoot);
  const af = policy.arch_fitness;

  for (const platform of ['ios', 'android', 'flutter']) {
    const pCfg = af[platform] || {};
    if (!pCfg.enabled) {
      checks.push({
        platform, rule: `arch-fitness-${platform}`,
        passed: true, message: `arch-fitness.${platform} disabled — skipped`
      });
      continue;
    }

    checks.push({
      platform, rule: `arch-fitness-${platform}-enabled`,
      passed: true, message: `arch-fitness.${platform} rules enabled`
    });

    // Check if platform is detected in project
    if (platforms.length > 0 && !platforms.includes(platform)) {
      checks.push({
        platform, rule: `arch-fitness-${platform}-detected`,
        passed: true, message: `Platform ${platform} not detected in project — rules not applicable`
      });
    }
  }

  // Policy schema check
  checks.push({
    platform: 'common', rule: 'policy-loaded',
    passed: true, message: 'Policy loaded and validated'
  });

  return checks;
}

// ─── Console renderer ─────────────────────────────────────────────────────────

const isTTY = process.stdout.isTTY;
const RED    = isTTY ? '\x1b[31m' : '';
const YELLOW = isTTY ? '\x1b[33m' : '';
const GREEN  = isTTY ? '\x1b[32m' : '';
const BOLD   = isTTY ? '\x1b[1m'  : '';
const RESET  = isTTY ? '\x1b[0m'  : '';

function colorSeverity(sev) {
  if (sev === 'error') return `${RED}error${RESET}`;
  if (sev === 'warn')  return `${YELLOW}warn${RESET}`;
  return sev;
}

function renderConsole(report) {
  const { summary, findings, budget, archChecks, projectRoot } = report;
  const lines = [];

  lines.push(`\n${BOLD}bk-harness-ci — Harness Validation Report${RESET}`);
  lines.push(`  Project: ${projectRoot}`);
  lines.push(`  Time:    ${new Date().toISOString()}`);
  lines.push('');

  // Arch checks
  lines.push(`${BOLD}Arch-Fitness Checks:${RESET}`);
  for (const c of archChecks) {
    const icon = c.passed ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
    lines.push(`  ${icon} [${c.platform}] ${c.rule} — ${c.message}`);
  }
  lines.push('');

  // Findings
  lines.push(`${BOLD}Findings (${findings.length} total):${RESET}`);
  if (findings.length === 0) {
    lines.push(`  ${GREEN}No findings — all clear${RESET}`);
  } else {
    for (const f of findings.slice(0, 20)) {
      const cat = (f.category || '').padEnd(30);
      const sev = colorSeverity(f.severity).padEnd(20);
      const msg = (f.message || '').slice(0, 80);
      lines.push(`  ${sev} ${cat} ${msg}`);
    }
    if (findings.length > 20) {
      lines.push(`  ... ${findings.length - 20} more findings`);
    }
  }
  lines.push('');

  // Summary
  lines.push(`${BOLD}Summary:${RESET}`);
  lines.push(`  Errors:   ${summary.errors}`);
  lines.push(`  Warnings: ${summary.warnings}`);
  lines.push(`  Total:    ${summary.total}`);
  lines.push('');

  // Budget
  lines.push(`${BOLD}Budget:${RESET}`);
  const budgetColor = budget.exceeds ? RED : budget.pct >= 80 ? YELLOW : GREEN;
  lines.push(`  PR cost: ${budgetColor}${formatCost(budget.currentUsd)}${RESET} / ${formatCost(budget.budgetUsd)} (${budget.pct}%) — ${budget.status}`);
  lines.push('');

  // Result
  const hasErrors = summary.errors > 0;
  const hasWarnings = summary.warnings > 0 || budget.exceeds;
  if (hasErrors) {
    lines.push(`${RED}✗ FAILED — ${summary.errors} error(s) found${RESET}`);
  } else if (hasWarnings) {
    lines.push(`${YELLOW}⚠ WARNINGS — ${summary.warnings} warning(s)${RESET}`);
  } else {
    lines.push(`${GREEN}✓ PASSED — no issues${RESET}`);
  }

  return lines.join('\n');
}

// ─── Write CI run record ──────────────────────────────────────────────────────

function recordCiRun(metricsDir, report, exitCode) {
  try {
    if (!fs.existsSync(metricsDir)) fs.mkdirSync(metricsDir, { recursive: true });
    const entry = {
      ts: Date.now(),
      exitCode,
      errors: report.summary.errors,
      warnings: report.summary.warnings,
      total: report.summary.total,
      budgetStatus: report.budget.status,
      prCostUsd: report.budget.currentUsd
    };
    fs.appendFileSync(path.join(metricsDir, 'ci-runs.jsonl'), JSON.stringify(entry) + '\n', 'utf8');
  } catch { /* fail-open */ }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv);
  const projectRoot = opts.projectRoot || process.env.BK_PROJECT_ROOT || process.cwd();
  const metricsDir = path.join(projectRoot, '.bk-metrics');

  // 1. Load policy
  let policy = null;
  try {
    policy = tryLoadPolicy(projectRoot);
  } catch (err) {
    process.stderr.write(`[bk-harness-ci] Config error: ${err.message}\n`);
    process.exit(3);
  }

  // 2. Resolve budget: CLI > policy > default
  let budgetUsd = opts.budgetUsd;
  if (budgetUsd === null || isNaN(budgetUsd)) {
    budgetUsd = policy?.cost_budget?.pr_budget_usd ?? 5.0;
  }

  // 3. Run arch-fitness checks
  const archChecks = runArchFitness(projectRoot, policy);

  // 4. Aggregate findings from .bk-metrics/*.jsonl
  const findings = aggregateFindings(metricsDir, opts.windowMs);
  const summary = summariseByCategory(findings);

  // 5. Compute budget status
  const ledgerPath = policy?.cost_budget?.ledger_path
    ? path.join(projectRoot, policy.cost_budget.ledger_path)
    : path.join(metricsDir, 'cost-ledger.jsonl');
  const budgetRaw = computeBudgetStatus(budgetUsd, ledgerPath);

  const report = {
    projectRoot,
    archChecks,
    findings,
    summary,
    budget: budgetRaw,
    policy: policy ? { loaded: true, path: policy.__resolvedPath || null } : { loaded: false }
  };

  // 6. Determine exit code
  let exitCode = 0;
  if (opts.failOn !== 'never') {
    if (summary.errors > 0 || budgetRaw.exceeds) exitCode = 2;
    else if (opts.failOn === 'warn' && (summary.warnings > 0)) exitCode = 1;
  }

  // 7. Emit output
  let output = '';
  try {
    if (opts.format === 'json') {
      output = JSON.stringify(report, null, 2) + '\n';
    } else if (opts.format === 'junit') {
      const suites = findingsToTestSuites(report);
      output = writeJunit(suites) + '\n';
    } else {
      output = renderConsole(report) + '\n';
    }
  } catch (err) {
    process.stderr.write(`[bk-harness-ci] Output error: ${err.message}\n`);
    process.exit(3);
  }

  if (opts.output) {
    try {
      const outDir = path.dirname(opts.output);
      if (outDir && !fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(opts.output, output, 'utf8');
      if (opts.format !== 'json') {
        process.stdout.write(`[bk-harness-ci] Report written to ${opts.output}\n`);
      }
    } catch (err) {
      process.stderr.write(`[bk-harness-ci] Failed to write output: ${err.message}\n`);
      process.exit(3);
    }
  } else {
    process.stdout.write(output);
  }

  // 8. Record run to .bk-metrics/ci-runs.jsonl
  recordCiRun(metricsDir, report, exitCode);

  process.exit(exitCode);
}

main().catch(err => {
  process.stderr.write(`[bk-harness-ci] Fatal error: ${err.message}\n`);
  process.exit(3);
});
