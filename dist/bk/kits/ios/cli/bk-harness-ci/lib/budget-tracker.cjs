'use strict';
/**
 * budget-tracker.cjs — Track PR-level cost from cost-ledger.jsonl.
 *
 * Uses GIT_BASE_REF env (or defaults to origin/main) to compute
 * the cost accumulated since the branch diverged from base.
 * Falls back to entire ledger sum when git is not available.
 */

const fs = require('fs');
const { execSync } = require('child_process');

/**
 * Get the ISO timestamp of the git merge-base commit vs the base ref.
 * Returns null if git is unavailable or the ref doesn't exist.
 *
 * @param {string} baseRef - e.g. "origin/main"
 * @param {string} [cwd] - working directory
 * @returns {number|null} epoch ms of merge-base commit, or null
 */
function getMergeBaseTimestamp(baseRef, cwd) {
  try {
    const mergeBase = execSync(
      `git merge-base HEAD ${baseRef}`,
      { cwd: cwd || process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }
    ).trim();
    if (!mergeBase) return null;

    const dateStr = execSync(
      `git show -s --format=%cI ${mergeBase}`,
      { cwd: cwd || process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }
    ).trim();
    if (!dateStr) return null;

    return new Date(dateStr).getTime();
  } catch {
    return null;
  }
}

/**
 * Read and parse the cost ledger JSONL file.
 *
 * @param {string} ledgerPath
 * @returns {object[]}
 */
function readLedger(ledgerPath) {
  if (!ledgerPath || !fs.existsSync(ledgerPath)) return [];
  try {
    const raw = fs.readFileSync(ledgerPath, 'utf8');
    return raw.split('\n').filter(Boolean).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

/**
 * Sum the USD cost from ledger entries, optionally filtered by a timestamp cutoff.
 *
 * @param {object[]} entries
 * @param {number} [sinceMs] - epoch ms; only count entries with ts >= sinceMs
 * @returns {number} total USD
 */
function sumCost(entries, sinceMs) {
  return entries.reduce((sum, e) => {
    if (sinceMs && (e.ts || 0) < sinceMs) return sum;
    const cost = e.cost_usd ?? e.costUsd ?? e.usd ?? e.cost ?? 0;
    return sum + (typeof cost === 'number' ? cost : 0);
  }, 0);
}

/**
 * Compute the total PR cost from the cost ledger.
 * Uses git merge-base to determine which entries belong to this PR.
 * Falls back to entire ledger if git is unavailable.
 *
 * @param {string} ledgerPath - absolute path to cost-ledger.jsonl
 * @param {{ baseRef?: string, cwd?: string }} [opts]
 * @returns {{ prCostUsd: number, totalLedgerUsd: number, sinceMs: number|null, method: string }}
 */
function getPrCost(ledgerPath, opts = {}) {
  const baseRef = opts.baseRef || process.env.GIT_BASE_REF || 'origin/main';
  const cwd = opts.cwd || (ledgerPath ? require('path').dirname(ledgerPath) : process.cwd());

  const entries = readLedger(ledgerPath);
  const totalLedgerUsd = sumCost(entries);

  // Try git-based PR cost
  const mergeBaseMs = getMergeBaseTimestamp(baseRef, cwd);

  if (mergeBaseMs !== null) {
    const prCostUsd = sumCost(entries, mergeBaseMs);
    return {
      prCostUsd: Math.round(prCostUsd * 100000) / 100000,
      totalLedgerUsd: Math.round(totalLedgerUsd * 100000) / 100000,
      sinceMs: mergeBaseMs,
      baseRef,
      method: 'git-merge-base'
    };
  }

  // Fallback: entire ledger
  return {
    prCostUsd: Math.round(totalLedgerUsd * 100000) / 100000,
    totalLedgerUsd: Math.round(totalLedgerUsd * 100000) / 100000,
    sinceMs: null,
    baseRef,
    method: 'ledger-fallback'
  };
}

/**
 * Format a cost value for display.
 * @param {number} usd
 * @returns {string}
 */
function formatCost(usd) {
  if (typeof usd !== 'number') return '$0.0000';
  return `$${usd.toFixed(4)}`;
}

module.exports = { getPrCost, readLedger, sumCost, getMergeBaseTimestamp, formatCost };
