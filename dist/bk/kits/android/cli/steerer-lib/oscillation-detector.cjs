/**
 * oscillation-detector.cjs — Detect file edit oscillations from file-edit-history.jsonl.
 *
 * A file that is edited >= 10 times with alternating/toggling changes
 * is a candidate for an oscillation preference entry.
 *
 * @example
 *   const { detectOscillations } = require('./oscillation-detector.cjs');
 *   const candidates = detectOscillations({ historyFile, minEdits: 10 });
 */

'use strict';

const { readJsonl } = require('./violation-analyzer.cjs');

/**
 * Detect oscillating file edits.
 *
 * @param {object} opts
 * @param {string} opts.historyFile — path to file-edit-history.jsonl
 * @param {number} [opts.minEdits=10] — minimum edits to flag as oscillation
 * @param {number} [opts.lookbackDays] — optional lookback window
 * @returns {Array<{
 *   type: 'oscillation',
 *   file: string,
 *   editCount: number,
 *   firstEdit: number,
 *   lastEdit: number,
 *   toggleScore: number,
 *   proposed_text: string
 * }>}
 */
function detectOscillations(opts = {}) {
  const { historyFile, minEdits = 10, lookbackDays } = opts;
  if (!historyFile) return [];

  const entries = readJsonl(historyFile);
  if (!entries.length) return [];

  let filtered = entries;
  if (lookbackDays) {
    const cutoff = Date.now() - (lookbackDays * 24 * 60 * 60 * 1000);
    filtered = entries.filter(e => !e.ts || e.ts >= cutoff);
  }

  // Group by file path
  const groups = {};
  for (const entry of filtered) {
    const file = entry.file || entry.file_path || entry.path || null;
    if (!file) continue;
    if (!groups[file]) {
      groups[file] = { edits: [], hashes: [] };
    }
    groups[file].edits.push(entry);
    if (entry.hash || entry.content_hash) {
      groups[file].hashes.push(entry.hash || entry.content_hash);
    }
  }

  const candidates = [];

  for (const [file, g] of Object.entries(groups)) {
    if (g.edits.length < minEdits) continue;

    // Calculate toggle score: how often the hash alternates
    const hashes = g.hashes;
    let toggles = 0;
    if (hashes.length >= 2) {
      for (let i = 1; i < hashes.length; i++) {
        if (hashes[i] !== hashes[i - 1] && i >= 2 && hashes[i] === hashes[i - 2]) {
          toggles++;
        }
      }
    }
    const toggleScore = hashes.length > 0 ? toggles / hashes.length : 0;

    const timestamps = g.edits.map(e => e.ts || 0).filter(t => t > 0);
    const firstEdit = timestamps.length ? Math.min(...timestamps) : 0;
    const lastEdit = timestamps.length ? Math.max(...timestamps) : 0;

    candidates.push({
      type: 'oscillation',
      file,
      editCount: g.edits.length,
      firstEdit,
      lastEdit,
      toggleScore: Math.round(toggleScore * 100) / 100,
      proposed_text: buildOscillationText(file, g.edits.length, toggleScore, firstEdit, lastEdit)
    });
  }

  // Sort by edit count descending
  candidates.sort((a, b) => b.editCount - a.editCount);
  return candidates;
}

/**
 * Build proposed text for an oscillating file.
 */
function buildOscillationText(file, editCount, toggleScore, firstEdit, lastEdit) {
  const firstDate = firstEdit ? new Date(firstEdit).toISOString().slice(0, 10) : 'unknown';
  const lastDate = lastEdit ? new Date(lastEdit).toISOString().slice(0, 10) : 'unknown';
  const togglePct = Math.round(toggleScore * 100);

  return `**Oscillation in \`${file}\`**: Edited ${editCount} times (${firstDate}–${lastDate}).` +
    (toggleScore > 0.2
      ? ` Toggle rate: ${togglePct}% — file content appears to be flipping back and forth.`
      : '') +
    ` Consider pinning the approach for this file in coding guidelines.`;
}

module.exports = { detectOscillations };
