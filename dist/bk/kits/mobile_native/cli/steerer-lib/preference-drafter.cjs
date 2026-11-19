/**
 * preference-drafter.cjs — Generate a draft markdown file from Candidates[].
 *
 * Produces a reviewable draft with checkboxes [ ] Accept / [ ] Reject / [ ] Modify
 * for each candidate. User reviews and approves before merging.
 *
 * @example
 *   const { draftPreferences } = require('./preference-drafter.cjs');
 *   const markdown = draftPreferences(candidates, { dryRun: false });
 */

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Generate a draft markdown string from candidates.
 *
 * @param {object[]} candidates — from violation-analyzer, decision-reverser, etc.
 * @param {object} [opts]
 * @param {string} [opts.title] — draft title override
 * @returns {string} — full markdown content
 */
function draftPreferences(candidates, opts = {}) {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = now.toISOString().slice(0, 16).replace('T', ' ');
  const title = opts.title || `Learned Preferences — Draft (auto-generated ${dateStr})`;

  const lines = [];
  lines.push(`# ${title}`);
  lines.push('');
  lines.push(`> Generated: ${timeStr}`);
  lines.push(`> Total candidates: ${candidates.length}`);
  lines.push('>');
  lines.push('> Review each item. For each:');
  lines.push('> - `[x] Accept` — will be merged into learned-preferences.md');
  lines.push('> - `[x] Reject` — will be discarded');
  lines.push('> - `[x] Modify` — edit the "Proposal" text below, then accept');
  lines.push('> Run `node steerer-cli.cjs --apply` after reviewing to apply accepted items.');
  lines.push('');

  if (!candidates || candidates.length === 0) {
    lines.push('_No candidates found. Metrics may be insufficient or all thresholds met._');
    return lines.join('\n');
  }

  // Group by type for sections
  const grouped = groupByType(candidates);

  // New preferences from violation patterns
  if (grouped.new_preference && grouped.new_preference.length > 0) {
    lines.push(`## New Preferences (${grouped.new_preference.length})`);
    lines.push('');
    for (const c of grouped.new_preference) {
      lines.push(...formatCandidate(c, 'NEW'));
    }
  }

  // Decision reversals / locks
  if (grouped.decision_reversal && grouped.decision_reversal.length > 0) {
    lines.push(`## Decision Locks (${grouped.decision_reversal.length})`);
    lines.push('');
    for (const c of grouped.decision_reversal) {
      lines.push(...formatCandidate(c, 'LOCK'));
    }
  }

  // Oscillation patterns
  if (grouped.oscillation && grouped.oscillation.length > 0) {
    lines.push(`## Oscillation Patterns (${grouped.oscillation.length})`);
    lines.push('');
    for (const c of grouped.oscillation) {
      lines.push(...formatCandidate(c, 'OSCILLATION'));
    }
  }

  // Budget overruns
  if (grouped.budget_overrun && grouped.budget_overrun.length > 0) {
    lines.push(`## Budget Adjustments (${grouped.budget_overrun.length})`);
    lines.push('');
    for (const c of grouped.budget_overrun) {
      lines.push(...formatCandidate(c, 'BUDGET'));
    }
  }

  return lines.join('\n');
}

/**
 * Group candidates by type.
 */
function groupByType(candidates) {
  const groups = {};
  for (const c of candidates) {
    const t = c.type || 'other';
    if (!groups[t]) groups[t] = [];
    groups[t].push(c);
  }
  return groups;
}

/**
 * Format a single candidate as markdown lines.
 */
function formatCandidate(c, tag) {
  const lines = [];
  const id = c.rule_id || c.scope || c.file || c.workflow_type || 'unknown';
  lines.push(`### [${tag}] ${id}`);

  // Trigger metadata
  if (c.count !== undefined && c.first_ts) {
    const firstDate = new Date(c.first_ts).toISOString().slice(0, 10);
    const lastDate = c.last_ts ? new Date(c.last_ts).toISOString().slice(0, 10) : firstDate;
    lines.push(`**Trigger**: ${c.count} occurrence(s) (${firstDate} to ${lastDate})`);
  } else if (c.editCount !== undefined) {
    lines.push(`**Trigger**: ${c.editCount} edits detected`);
  }

  // Proposal
  lines.push('**Proposal**:');
  lines.push(`> ${(c.proposed_text || 'No proposed text').replace(/\n/g, '\n> ')}`);

  // Status checkboxes
  lines.push('');
  lines.push('**Status**: [ ] Accept  [ ] Reject  [ ] Modify');
  lines.push('');
  lines.push('---');
  lines.push('');
  return lines;
}

/**
 * Write draft to a file path.
 *
 * @param {object[]} candidates
 * @param {string} draftPath — output file path
 * @param {object} [opts]
 * @returns {{ written: boolean, path: string, candidateCount: number }}
 */
function writeDraft(candidates, draftPath, opts = {}) {
  const content = draftPreferences(candidates, opts);

  try {
    const dir = path.dirname(draftPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(draftPath, content, 'utf8');
    return { written: true, path: draftPath, candidateCount: candidates.length };
  } catch (err) {
    process.stderr.write(`[preference-drafter] Failed to write draft: ${err.message}\n`);
    return { written: false, path: draftPath, candidateCount: candidates.length };
  }
}

module.exports = { draftPreferences, writeDraft };
