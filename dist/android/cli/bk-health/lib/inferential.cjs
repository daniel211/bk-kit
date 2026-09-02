/**
 * inferential.cjs — Dashboard panel for Inferential Review sensor data.
 *
 * Reads .bk-metrics/inferential-results.jsonl and produces a summary
 * panel for the bk-health dashboard.
 *
 * Exports:
 *   buildInferentialPanel(metricsDir) → InferentialPanel
 *
 * InferentialPanel: {
 *   recent_reviews: ReviewEntry[],   // last 20 entries from JSONL
 *   fail_count: number,              // reviews in last 24h below threshold
 *   avg_score: number|null,          // average overall_score across all entries
 *   last_5: ReviewEntry[]            // last 5 for dashboard rendering
 * }
 */

'use strict';

const fs = require('fs');
const path = require('path');

const RESULTS_FILE = 'inferential-results.jsonl';
const MAX_ENTRIES = 20;
const WINDOW_24H = 24 * 60 * 60 * 1000;
// Threshold below which a review is considered a "fail"
const DEFAULT_THRESHOLD = 0.7;

/**
 * Read up to last N entries from a JSONL file.
 * Silently skips malformed lines.
 *
 * @param {string} filePath
 * @param {number} maxLines
 * @returns {object[]}
 */
function readLastN(filePath, maxLines) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const lines = raw.split('\n').filter(l => l.trim().length > 0);
    const lastLines = lines.slice(-maxLines);
    const entries = [];
    for (const line of lastLines) {
      try {
        entries.push(JSON.parse(line));
      } catch {
        // Malformed line — skip
      }
    }
    return entries;
  } catch {
    return [];
  }
}

/**
 * Build inferential review panel data from metricsDir.
 *
 * @param {string} metricsDir — absolute path to .bk-metrics/ directory
 * @param {object} [opts]     — { threshold?: number }
 * @returns {{ recent_reviews: object[], fail_count: number, avg_score: number|null, last_5: object[] }}
 */
function buildInferentialPanel(metricsDir, opts = {}) {
  const threshold = opts.threshold != null ? opts.threshold : DEFAULT_THRESHOLD;
  const resultsPath = path.join(metricsDir, RESULTS_FILE);

  const recent_reviews = readLastN(resultsPath, MAX_ENTRIES);

  // Count fails in last 24h
  const cutoff = Date.now() - WINDOW_24H;
  const fail_count = recent_reviews.filter(r => {
    return r.ts >= cutoff && typeof r.overall_score === 'number' && r.overall_score < threshold;
  }).length;

  // Average score across all retrieved entries (with valid scores)
  const scoredEntries = recent_reviews.filter(r => typeof r.overall_score === 'number');
  const avg_score = scoredEntries.length > 0
    ? scoredEntries.reduce((sum, r) => sum + r.overall_score, 0) / scoredEntries.length
    : null;

  // Last 5 for display
  const last_5 = recent_reviews.slice(-5).reverse();

  return { recent_reviews, fail_count, avg_score, last_5 };
}

/**
 * Render inferential panel as lines for dashboard boxLine() rendering.
 *
 * @param {{ recent_reviews, fail_count, avg_score, last_5 }} panel
 * @returns {string[]} lines to pass through boxLine()
 */
function renderInferentialPanel(panel) {
  const { recent_reviews, fail_count, avg_score, last_5 } = panel;
  const lines = [];

  if (recent_reviews.length === 0) {
    lines.push('No inferential reviews recorded yet');
    return lines;
  }

  // Average score
  const avgStr = avg_score != null ? avg_score.toFixed(2) : 'n/a';
  lines.push(`Avg score: ${avgStr}  |  Fails (24h): ${fail_count}  |  Total reviewed: ${recent_reviews.length}`);
  lines.push('');

  // Last 5 reviews
  lines.push('Last 5 reviews:');
  for (const r of last_5) {
    const dt = r.ts ? new Date(r.ts).toISOString().slice(11, 19) : '?';
    const score = typeof r.overall_score === 'number' ? r.overall_score.toFixed(2) : 'n/a';
    const fileCount = r.file_count || (r.files || []).length || 0;
    const issueCount = r.issue_count || (r.issues || []).length || 0;
    const status = typeof r.overall_score === 'number' && r.overall_score < DEFAULT_THRESHOLD ? '✗' : '✓';
    lines.push(`  ${status} [${dt}] score=${score} files=${fileCount} issues=${issueCount}`);
  }

  return lines;
}

module.exports = { buildInferentialPanel, renderInferentialPanel };
