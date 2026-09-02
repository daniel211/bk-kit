'use strict';
/**
 * aggregator.cjs — Aggregate findings from .bk-metrics/*.jsonl files.
 *
 * Merges violations, red-signals, inferential-results, and native-lint
 * streams into a canonical finding list suitable for CI reporting.
 */

const fs = require('fs');
const path = require('path');

/**
 * Read and parse a JSONL file, returning array of objects.
 * @param {string} filePath
 * @param {number} [windowMs] - optional time window cutoff
 * @returns {object[]}
 */
function readJsonl(filePath, windowMs) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  try {
    const cutoff = windowMs ? Date.now() - windowMs : 0;
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw.split('\n').filter(Boolean).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(e => e && (windowMs ? (e.ts || 0) >= cutoff : true));
  } catch { return []; }
}

/**
 * Normalise a raw JSONL entry into a canonical finding.
 * @param {object} entry
 * @param {string} source - which file it came from
 * @returns {object} canonical finding
 */
function normalise(entry, source) {
  const severity = entry.severity || entry.level ||
    (entry.blocked ? 'error' : entry.type === 'budget_exceeded' ? 'error' : 'warn');
  return {
    id: entry.id || `${source}:${entry.ts || Date.now()}`,
    ts: entry.ts || Date.now(),
    source,
    severity: severity === 'critical' ? 'error' : severity,
    category: entry.category || entry.hook || entry.violation_type || entry.type || source,
    message: entry.message || entry.reason || entry.context || entry.violation_type || '',
    rule: entry.rule || entry.violation_type || entry.hook || '',
    agent: entry.agent || entry.tool || '',
    raw: entry
  };
}

/**
 * Aggregate findings from all known .bk-metrics/*.jsonl streams.
 *
 * @param {string} metricsDir - path to .bk-metrics directory
 * @param {number} [windowMs] - time window in ms (default: all-time)
 * @returns {object[]} canonical finding list, sorted by ts descending
 */
function aggregateFindings(metricsDir, windowMs) {
  const sources = [
    { file: 'violations.jsonl',         key: 'violations'      },
    { file: 'red-signals.jsonl',         key: 'red_signals'     },
    { file: 'inferential-results.jsonl', key: 'inferential'     },
    { file: 'native-lint.jsonl',         key: 'native_lint'     },
    { file: 'ashby-warnings.jsonl',      key: 'ashby'           },
    { file: 'ci-runs.jsonl',             key: 'ci_runs'         }
  ];

  const findings = [];
  for (const { file, key } of sources) {
    const filePath = path.join(metricsDir, file);
    const entries = readJsonl(filePath, windowMs);
    for (const e of entries) {
      findings.push(normalise(e, key));
    }
  }

  // Sort by ts descending (most recent first)
  findings.sort((a, b) => b.ts - a.ts);
  return findings;
}

/**
 * Summarise findings by severity and category.
 *
 * @param {object[]} findings - from aggregateFindings()
 * @returns {{ bySeverity: object, byCategory: object, total: number, errors: number, warnings: number }}
 */
function summariseByCategory(findings) {
  const bySeverity = {};
  const byCategory = {};

  for (const f of findings) {
    bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
    byCategory[f.category] = (byCategory[f.category] || 0) + 1;
  }

  return {
    total: findings.length,
    errors: bySeverity.error || 0,
    warnings: bySeverity.warn || 0,
    bySeverity,
    byCategory
  };
}

/**
 * Compute budget status by comparing PR cost vs budget threshold.
 *
 * @param {number} budgetUsd - budget limit in USD
 * @param {string} [ledgerPath] - path to cost-ledger.jsonl
 * @returns {{ budgetUsd: number, currentUsd: number, exceeds: boolean, pct: number, status: string }}
 */
function computeBudgetStatus(budgetUsd, ledgerPath) {
  let currentUsd = 0;
  if (ledgerPath && fs.existsSync(ledgerPath)) {
    try {
      const raw = fs.readFileSync(ledgerPath, 'utf8');
      const entries = raw.split('\n').filter(Boolean).map(l => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean);
      currentUsd = entries.reduce((sum, e) => sum + (e.cost_usd || e.costUsd || e.usd || 0), 0);
    } catch { /* fail-open */ }
  }

  const exceeds = budgetUsd > 0 && currentUsd > budgetUsd;
  const pct = budgetUsd > 0 ? Math.round((currentUsd / budgetUsd) * 100) : 0;
  const status = exceeds ? 'exceeded' : pct >= 80 ? 'warning' : 'ok';

  return { budgetUsd, currentUsd: Math.round(currentUsd * 10000) / 10000, exceeds, pct, status };
}

module.exports = { aggregateFindings, summariseByCategory, computeBudgetStatus, readJsonl, normalise };
