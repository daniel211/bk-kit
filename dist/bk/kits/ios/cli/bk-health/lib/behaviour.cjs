'use strict';
/**
 * behaviour.cjs — Behaviour Harness panel for bk-health dashboard.
 *
 * Reads from .bk-metrics/:
 *   - test-gaps.jsonl         (last 24h)
 *   - ui-snapshot-findings.jsonl
 *   - mutation-readiness.json
 *   - pbt-suggestions.jsonl
 *
 * Exports:
 *   buildBehaviourPanel(metricsDir, windowMs?) → BehaviourPanelData
 *   renderBehaviourPanel(data) → string[]
 */

const fs = require('fs');
const path = require('path');

const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

/**
 * Read and parse a JSONL file, returning an array of parsed objects.
 * Returns [] on file-not-found or parse errors (fail-open).
 * @param {string} filePath
 * @param {number} [windowMs] - Optional time window filter (filter by .timestamp field)
 * @returns {Array<object>}
 */
function readJsonl(filePath, windowMs) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, 'utf8');
    const all = raw.split('\n').filter(Boolean).map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);

    if (!windowMs) return all;

    const cutoff = Date.now() - windowMs;
    return all.filter(e => {
      if (!e) return false;
      // Support both numeric ts and ISO timestamp string
      const t = e.ts || (e.timestamp ? new Date(e.timestamp).getTime() : 0);
      return t >= cutoff;
    });
  } catch { return []; }
}

/**
 * Read a JSON file, returning null on error.
 * @param {string} filePath
 * @returns {object|null}
 */
function readJson(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch { return null; }
}

/**
 * Build behaviour panel data.
 *
 * @param {string} metricsDir - Absolute path to .bk-metrics directory
 * @param {number} [windowMs] - Time window in ms (default 24h)
 * @returns {{
 *   testGapCount: number,
 *   uiSnapshotCount: number,
 *   mutationReadiness: { ios: object, android: object, flutter: object } | null,
 *   pbtSuggestionCount: number,
 *   windowMs: number
 * }}
 */
function buildBehaviourPanel(metricsDir, windowMs) {
  const win = windowMs || TWENTY_FOUR_HOURS;

  // Test gaps (last N hours)
  const testGaps = readJsonl(path.join(metricsDir, 'test-gaps.jsonl'), win);
  const testGapCount = testGaps.length;

  // UI snapshot findings (last N hours)
  const uiFindings = readJsonl(path.join(metricsDir, 'ui-snapshot-findings.jsonl'), win);
  const uiSnapshotCount = uiFindings.length;

  // Mutation readiness (single JSON file, not time-windowed)
  const mutationReadiness = readJson(path.join(metricsDir, 'mutation-readiness.json'));

  // PBT suggestions (last N hours)
  const pbtSuggestions = readJsonl(path.join(metricsDir, 'pbt-suggestions.jsonl'), win);
  const pbtSuggestionCount = pbtSuggestions.length;

  return {
    testGapCount,
    uiSnapshotCount,
    mutationReadiness,
    pbtSuggestionCount,
    windowMs: win
  };
}

/**
 * Render the behaviour panel as an array of display strings.
 * @param {{ testGapCount: number, uiSnapshotCount: number, mutationReadiness: object|null, pbtSuggestionCount: number, windowMs: number }} panel
 * @returns {string[]}
 */
function renderBehaviourPanel(panel) {
  if (!panel) return ['  (no data)'];

  const { testGapCount, uiSnapshotCount, mutationReadiness, pbtSuggestionCount, windowMs } = panel;
  const windowHours = Math.round((windowMs || TWENTY_FOUR_HOURS) / (60 * 60 * 1000));
  const windowLabel = windowHours >= 24 ? `${Math.round(windowHours / 24)}d` : `${windowHours}h`;

  const lines = [];

  // Test gaps
  lines.push(`  Test gaps (${windowLabel}): ${testGapCount === 0 ? 'none' : testGapCount}`);

  // UI snapshot findings
  lines.push(`  UI snapshot findings (${windowLabel}): ${uiSnapshotCount === 0 ? 'none' : uiSnapshotCount}`);

  // Mutation readiness per platform
  if (mutationReadiness) {
    const platforms = ['ios', 'android', 'flutter'];
    for (const platform of platforms) {
      const result = mutationReadiness[platform];
      if (!result) continue;
      const status = result.ready
        ? `ready (${result.tool || 'configured'})`
        : 'not configured';
      const indicator = result.ready ? '\u2713' : '\u2717';
      lines.push(`  Mutation [${platform}]: ${indicator} ${status}`);
    }
  } else {
    lines.push('  Mutation readiness: not scanned yet');
  }

  // PBT suggestions
  lines.push(`  PBT suggestions (${windowLabel}): ${pbtSuggestionCount === 0 ? 'none' : pbtSuggestionCount}`);

  return lines;
}

module.exports = { buildBehaviourPanel, renderBehaviourPanel };
