/**
 * decision-reverser.cjs — Detect decision reversals in decisions.jsonl.
 *
 * Groups decisions by scope. If the same scope has >= 2 different choices made at
 * different times → "reversal candidate" (potential flip-flop to lock down).
 *
 * @example
 *   const { analyzeDecisions } = require('./decision-reverser.cjs');
 *   const candidates = analyzeDecisions({ decisionsFile });
 */

'use strict';

const { readJsonl } = require('./violation-analyzer.cjs');

/**
 * Detect decision reversals.
 *
 * @param {object} opts
 * @param {string} opts.decisionsFile — absolute path to decisions.jsonl
 * @param {number} [opts.lookbackDays] — how far back to look (default: all time)
 * @returns {Array<{
 *   type: 'decision_reversal',
 *   scope: string,
 *   choices: string[],
 *   timestamps: number[],
 *   count: number,
 *   proposed_text: string
 * }>}
 */
function analyzeDecisions(opts = {}) {
  const { decisionsFile, lookbackDays } = opts;
  if (!decisionsFile) return [];

  const entries = readJsonl(decisionsFile);
  if (!entries.length) return [];

  let filtered = entries;
  if (lookbackDays) {
    const cutoff = Date.now() - (lookbackDays * 24 * 60 * 60 * 1000);
    filtered = entries.filter(e => !e.ts || e.ts >= cutoff);
  }

  // Group by scope
  const groups = {};
  for (const entry of filtered) {
    const scope = entry.scope || entry.topic || entry.category || 'general';
    const choice = entry.choice || entry.decision || entry.value || null;
    if (!choice) continue;

    if (!groups[scope]) {
      groups[scope] = {
        choices: [],
        timestamps: [],
        entries: []
      };
    }
    groups[scope].choices.push(String(choice));
    groups[scope].timestamps.push(entry.ts || 0);
    groups[scope].entries.push(entry);
  }

  const candidates = [];

  for (const [scope, g] of Object.entries(groups)) {
    // Detect if there are >= 2 distinct choices for the same scope
    const uniqueChoices = [...new Set(g.choices)];
    if (uniqueChoices.length < 2) continue;

    const firstDate = new Date(Math.min(...g.timestamps)).toISOString().slice(0, 10);
    const lastDate = new Date(Math.max(...g.timestamps)).toISOString().slice(0, 10);

    candidates.push({
      type: 'decision_reversal',
      scope,
      choices: uniqueChoices,
      timestamps: g.timestamps,
      count: g.choices.length,
      proposed_text: buildReversalText(scope, uniqueChoices, firstDate, lastDate)
    });
  }

  // Sort by number of reversals (more changes = higher priority)
  candidates.sort((a, b) => b.choices.length - a.choices.length);
  return candidates;
}

/**
 * Build proposed text for locking a decision after reversal detection.
 */
function buildReversalText(scope, choices, firstDate, lastDate) {
  const choiceList = choices.map(c => `"${c}"`).join(' vs ');
  return `**Decision lock (${scope})**: Conflicting choices detected: ${choiceList}. ` +
    `Pin to one option to prevent oscillation.\n` +
    `_(reversal detected between ${firstDate} and ${lastDate})_`;
}

module.exports = { analyzeDecisions };
