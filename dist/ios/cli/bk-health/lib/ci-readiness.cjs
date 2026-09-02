'use strict';
/**
 * ci-readiness.cjs — CI/CD Readiness dashboard panel.
 *
 * Checks:
 *   - Pre-commit hook installed
 *   - GitHub Actions template present
 *   - Last CI run result (from .bk-metrics/ci-runs.jsonl)
 *   - Budget status: current PR cost / budget
 */

const fs = require('fs');
const path = require('path');

/**
 * Read the last N entries from a JSONL file.
 * @param {string} filePath
 * @param {number} [n=1]
 * @returns {object[]}
 */
function readLastJsonl(filePath, n = 1) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    return lines.slice(-n).map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

/**
 * Check if a native pre-commit hook is installed.
 * @param {string} projectRoot
 * @returns {{ installed: boolean, framework: string | null, path: string | null }}
 */
function checkPreCommitHook(projectRoot) {
  // Native git hook
  const nativePath = path.join(projectRoot, '.git', 'hooks', 'pre-commit');
  if (fs.existsSync(nativePath)) {
    const content = fs.readFileSync(nativePath, 'utf8');
    const isMkHook = content.includes('bk-harness-ci') || content.includes('bk-harness');
    return {
      installed: true,
      framework: 'native',
      path: nativePath,
      isMkHook
    };
  }

  // Husky
  const huskyPath = path.join(projectRoot, '.husky', 'pre-commit');
  if (fs.existsSync(huskyPath)) {
    const content = fs.readFileSync(huskyPath, 'utf8');
    return {
      installed: true,
      framework: 'husky',
      path: huskyPath,
      isMkHook: content.includes('bk-harness-ci')
    };
  }

  // pre-commit framework
  const preCommitConfig = path.join(projectRoot, '.pre-commit-config.yaml');
  if (fs.existsSync(preCommitConfig)) {
    const content = fs.readFileSync(preCommitConfig, 'utf8');
    if (content.includes('bk-harness-ci')) {
      return {
        installed: true,
        framework: 'pre-commit',
        path: preCommitConfig,
        isMkHook: true
      };
    }
  }

  return { installed: false, framework: null, path: null, isMkHook: false };
}

/**
 * Check if GitHub Actions templates are present.
 * @param {string} projectRoot
 * @returns {{ present: boolean, templateFiles: string[] }}
 */
function checkGitHubActions(projectRoot) {
  const templateFiles = [];

  // Check in standard GitHub Actions location
  const ghActionsDir = path.join(projectRoot, '.github', 'workflows');
  if (fs.existsSync(ghActionsDir)) {
    try {
      const files = fs.readdirSync(ghActionsDir);
      const harnesFiles = files.filter(f => f.includes('harness'));
      templateFiles.push(...harnesFiles.map(f => path.join('.github/workflows', f)));
    } catch { /* ignore */ }
  }

  // Check for template files in src/templates or dist
  const srcTemplateDir = path.join(projectRoot, 'src', 'templates', 'github-actions');
  if (fs.existsSync(srcTemplateDir)) {
    try {
      const files = fs.readdirSync(srcTemplateDir);
      templateFiles.push(...files.map(f => path.join('src/templates/github-actions', f)));
    } catch { /* ignore */ }
  }

  return {
    present: templateFiles.length > 0,
    templateFiles
  };
}

/**
 * Get last CI run metadata from .bk-metrics/ci-runs.jsonl.
 * @param {string} metricsDir
 * @returns {object | null}
 */
function getLastCiRun(metricsDir) {
  const entries = readLastJsonl(path.join(metricsDir, 'ci-runs.jsonl'), 1);
  return entries[0] || null;
}

/**
 * Get budget status from cost ledger.
 * @param {string} metricsDir
 * @param {number} [budgetUsd=5.0]
 * @returns {{ currentUsd: number, budgetUsd: number, pct: number, status: string }}
 */
function getBudgetStatus(metricsDir, budgetUsd = 5.0) {
  const ledgerPath = path.join(metricsDir, 'cost-ledger.jsonl');
  let currentUsd = 0;

  if (fs.existsSync(ledgerPath)) {
    try {
      const raw = fs.readFileSync(ledgerPath, 'utf8');
      const entries = raw.split('\n').filter(Boolean).map(l => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean);
      currentUsd = entries.reduce((s, e) => s + (e.cost_usd ?? e.costUsd ?? e.usd ?? 0), 0);
    } catch { /* fail-open */ }
  }

  const pct = budgetUsd > 0 ? Math.round((currentUsd / budgetUsd) * 100) : 0;
  const status = currentUsd > budgetUsd ? 'exceeded' : pct >= 80 ? 'warning' : 'ok';

  return {
    currentUsd: Math.round(currentUsd * 10000) / 10000,
    budgetUsd,
    pct,
    status
  };
}

/**
 * Build the CI/CD readiness panel data.
 * @param {string} metricsDir - path to .bk-metrics directory
 * @param {{ projectRoot?: string, budgetUsd?: number }} [opts]
 * @returns {object} panel data
 */
function buildCiReadinessPanel(metricsDir, opts = {}) {
  const projectRoot = opts.projectRoot || path.dirname(metricsDir);
  const budgetUsd = opts.budgetUsd ?? 5.0;

  const preCommit = checkPreCommitHook(projectRoot);
  const githubActions = checkGitHubActions(projectRoot);
  const lastCiRun = getLastCiRun(metricsDir);
  const budgetStatus = getBudgetStatus(metricsDir, budgetUsd);

  return {
    preCommit,
    githubActions,
    lastCiRun,
    budgetStatus
  };
}

/**
 * Render CI/CD readiness panel as text lines.
 * @param {object} panel - from buildCiReadinessPanel()
 * @returns {string[]} rendered lines
 */
function renderCiReadinessPanel(panel) {
  const { preCommit, githubActions, lastCiRun, budgetStatus } = panel;
  const lines = [];

  // Pre-commit status
  if (preCommit.installed) {
    const fw = preCommit.framework || 'native';
    const mk = preCommit.isMkHook ? ' (bk-harness)' : ' (external)';
    lines.push(`  ✓ Pre-commit installed: ${fw}${mk}`);
  } else {
    lines.push(`  ✗ Pre-commit not installed — run: node src/cli/bk-precommit-install.cjs`);
  }

  // GitHub Actions
  if (githubActions.present) {
    const count = githubActions.templateFiles.length;
    lines.push(`  ✓ GitHub Actions template: ${count} file(s) found`);
    for (const f of githubActions.templateFiles.slice(0, 3)) {
      lines.push(`      ${f}`);
    }
  } else {
    lines.push(`  ✗ GitHub Actions template not found`);
  }

  // Last CI run
  if (lastCiRun) {
    const ts = new Date(lastCiRun.ts || 0).toISOString().slice(0, 19).replace('T', ' ');
    const code = lastCiRun.exitCode ?? '?';
    const status = code === 0 ? '✓ PASS' : `✗ FAIL (exit ${code})`;
    lines.push(`  ${code === 0 ? '✓' : '✗'} Last CI run: ${ts} — ${status}`);
    lines.push(`      Errors: ${lastCiRun.errors ?? 0}  Warnings: ${lastCiRun.warnings ?? 0}`);
  } else {
    lines.push(`  ⊘ No CI runs recorded yet`);
  }

  // Budget
  const budgetIcon = budgetStatus.status === 'exceeded' ? '✗' :
                     budgetStatus.status === 'warning'  ? '⚠' : '✓';
  lines.push(
    `  ${budgetIcon} Budget: $${budgetStatus.currentUsd.toFixed(4)} / $${budgetStatus.budgetUsd.toFixed(2)} (${budgetStatus.pct}%) — ${budgetStatus.status}`
  );

  return lines;
}

module.exports = {
  buildCiReadinessPanel,
  renderCiReadinessPanel,
  checkPreCommitHook,
  checkGitHubActions,
  getLastCiRun,
  getBudgetStatus
};
