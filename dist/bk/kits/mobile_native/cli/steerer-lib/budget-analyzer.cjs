/**
 * budget-analyzer.cjs — Detect workflows that consistently exceed their budget estimate.
 *
 * Reads workflow-summary.jsonl and detects entries where actual cost > 2× estimated budget.
 *
 * @example
 *   const { analyzeBudgets } = require('./budget-analyzer.cjs');
 *   const candidates = analyzeBudgets({ summaryFile });
 */

'use strict';

const { readJsonl } = require('./violation-analyzer.cjs');

/**
 * Analyze workflow budgets for consistent overruns.
 *
 * @param {object} opts
 * @param {string} opts.summaryFile — path to workflow-summary.jsonl
 * @param {number} [opts.overrunMultiple=2] — flag if actual > estimate * this multiple
 * @param {number} [opts.minOccurrences=2] — min overruns to become a candidate
 * @param {number} [opts.lookbackDays] — optional lookback
 * @returns {Array<{
 *   type: 'budget_overrun',
 *   workflow_type: string,
 *   overrunCount: number,
 *   avgMultiple: number,
 *   examples: Array<{ts, estimated, actual, multiple}>,
 *   proposed_text: string
 * }>}
 */
function analyzeBudgets(opts = {}) {
  const {
    summaryFile,
    overrunMultiple = 2,
    minOccurrences = 2,
    lookbackDays
  } = opts;

  if (!summaryFile) return [];

  const entries = readJsonl(summaryFile);
  if (!entries.length) return [];

  let filtered = entries;
  if (lookbackDays) {
    const cutoff = Date.now() - (lookbackDays * 24 * 60 * 60 * 1000);
    filtered = entries.filter(e => !e.ts || e.ts >= cutoff);
  }

  // Group by workflow_type or task_type
  const groups = {};
  for (const entry of filtered) {
    const estimated = entry.budget_estimated || entry.estimated_budget || entry.estimated || null;
    const actual = entry.budget_actual || entry.actual_cost || entry.actual || null;

    if (!estimated || !actual || estimated <= 0) continue;

    const multiple = actual / estimated;
    if (multiple <= overrunMultiple) continue; // Not a significant overrun

    const workflowType = entry.workflow_type || entry.task_type || entry.agent || 'general';

    if (!groups[workflowType]) {
      groups[workflowType] = { overruns: [] };
    }
    groups[workflowType].overruns.push({
      ts: entry.ts || 0,
      estimated,
      actual,
      multiple: Math.round(multiple * 10) / 10
    });
  }

  const candidates = [];

  for (const [workflowType, g] of Object.entries(groups)) {
    if (g.overruns.length < minOccurrences) continue;

    const avgMultiple = g.overruns.reduce((s, o) => s + o.multiple, 0) / g.overruns.length;

    candidates.push({
      type: 'budget_overrun',
      workflow_type: workflowType,
      overrunCount: g.overruns.length,
      avgMultiple: Math.round(avgMultiple * 10) / 10,
      examples: g.overruns.slice(0, 3), // top 3 examples
      proposed_text: buildBudgetText(workflowType, g.overruns.length, avgMultiple)
    });
  }

  candidates.sort((a, b) => b.overrunCount - a.overrunCount);
  return candidates;
}

/**
 * Build proposed text for budget overrun pattern.
 */
function buildBudgetText(workflowType, count, avgMultiple) {
  const pct = Math.round((avgMultiple - 1) * 100);
  return `**Budget multiplier update (${workflowType})**: Consistently overruns by ~${pct}% ` +
    `(${count} occurrences, avg ${avgMultiple}× budget). ` +
    `Consider updating effort-baseline.md with a ${avgMultiple}× multiplier for this workflow type.`;
}

module.exports = { analyzeBudgets };
