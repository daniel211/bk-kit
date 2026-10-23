/**
 * preference-merger.cjs — Parse accepted items from draft and append to target file.
 *
 * Reads a draft markdown file, finds sections marked `[x] Accept`,
 * extracts the Proposal text, and appends them to learned-preferences.md.
 * Creates a timestamped backup before modifying the target.
 *
 * @example
 *   const { mergeDraft } = require('./preference-merger.cjs');
 *   const result = mergeDraft({ draftPath, targetPath, backupDir });
 */

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Parse accepted items from a draft markdown file.
 *
 * Looks for sections with `[x] Accept` (case-insensitive).
 * Extracts the ### header and > Proposal blockquote text.
 *
 * @param {string} content — draft markdown content
 * @returns {Array<{ id: string, tag: string, proposalText: string }>}
 */
function parseAcceptedItems(content) {
  const accepted = [];
  if (!content) return accepted;

  // Split into sections by ### headers
  const sections = content.split(/\n(?=###\s)/);

  for (const section of sections) {
    if (!section.trim().startsWith('###')) continue;

    // Check if this section has [x] Accept
    // Support both "[x] Accept" and "[X] Accept"
    if (!/\[x\]\s*Accept/i.test(section)) continue;

    // Extract header
    const headerMatch = section.match(/^###\s*\[(\w+)\]\s*(.+)/m);
    if (!headerMatch) continue;
    const tag = headerMatch[1];
    const id = headerMatch[2].trim();

    // Extract proposal text from blockquote (> lines)
    const proposalLines = [];
    let inProposal = false;
    for (const line of section.split('\n')) {
      if (line.startsWith('**Proposal**:')) {
        inProposal = true;
        continue;
      }
      if (inProposal) {
        if (line.startsWith('> ')) {
          proposalLines.push(line.slice(2));
        } else if (line.startsWith('>')) {
          proposalLines.push(line.slice(1));
        } else if (line.trim() === '') {
          // blank line after blockquote = end of proposal
          if (proposalLines.length > 0) break;
        } else {
          break; // non-blockquote line = end of proposal
        }
      }
    }

    const proposalText = proposalLines.join('\n').trim();
    if (proposalText || id) {
      accepted.push({ id, tag, proposalText });
    }
  }

  return accepted;
}

/**
 * Create a timestamped backup of a file.
 *
 * @param {string} targetPath — file to back up
 * @param {string} backupDir — directory for backups
 * @returns {string|null} — backup path or null if backup failed
 */
function createBackup(targetPath, backupDir) {
  try {
    if (!fs.existsSync(targetPath)) return null;
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupName = `${ts}.md`;
    const backupPath = path.join(backupDir, backupName);
    fs.copyFileSync(targetPath, backupPath);
    return backupPath;
  } catch (err) {
    process.stderr.write(`[preference-merger] Backup failed: ${err.message}\n`);
    return null;
  }
}

/**
 * Build content to append to learned-preferences.md from accepted items.
 *
 * @param {Array<{id, tag, proposalText}>} items
 * @returns {string}
 */
function buildAppendContent(items) {
  if (!items || items.length === 0) return '';

  const now = new Date().toISOString().slice(0, 10);
  const lines = [];
  lines.push('');
  lines.push(`---`);
  lines.push(`<!-- merged by steerer on ${now} -->`);
  lines.push('');

  for (const item of items) {
    lines.push(`## [${item.tag}] ${item.id}`);
    lines.push('');
    if (item.proposalText) {
      lines.push(item.proposalText);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Merge accepted items from draft into target file.
 *
 * @param {object} opts
 * @param {string} opts.draftPath — path to draft markdown
 * @param {string} opts.targetPath — path to learned-preferences.md
 * @param {string} opts.backupDir — directory for backups
 * @param {boolean} [opts.dryRun=false] — if true, only return what would be merged
 * @returns {{
 *   accepted: Array<{id, tag, proposalText}>,
 *   backupPath: string|null,
 *   written: boolean,
 *   dryRun: boolean
 * }}
 */
function mergeDraft(opts = {}) {
  const { draftPath, targetPath, backupDir, dryRun = false } = opts;

  if (!draftPath || !fs.existsSync(draftPath)) {
    process.stderr.write(`[preference-merger] Draft not found: ${draftPath}\n`);
    return { accepted: [], backupPath: null, written: false, dryRun };
  }

  const draftContent = fs.readFileSync(draftPath, 'utf8');
  const accepted = parseAcceptedItems(draftContent);

  if (accepted.length === 0) {
    return { accepted: [], backupPath: null, written: false, dryRun };
  }

  if (dryRun) {
    return { accepted, backupPath: null, written: false, dryRun: true };
  }

  // Create backup
  const backupPath = createBackup(targetPath, backupDir || path.join(path.dirname(targetPath), '.bk-metrics', 'learned-preferences-backups'));

  // Append to target
  const appendContent = buildAppendContent(accepted);

  try {
    const targetDir = path.dirname(targetPath);
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

    // If target doesn't exist, create it with a header
    if (!fs.existsSync(targetPath)) {
      fs.writeFileSync(targetPath, '# Learned Preferences\n\n_Auto-populated by steerer. Review before relying on these entries._\n', 'utf8');
    }

    fs.appendFileSync(targetPath, appendContent, 'utf8');
    return { accepted, backupPath, written: true, dryRun: false };
  } catch (err) {
    process.stderr.write(`[preference-merger] Write failed: ${err.message}\n`);
    return { accepted, backupPath, written: false, dryRun: false };
  }
}

module.exports = { mergeDraft, parseAcceptedItems, createBackup, buildAppendContent };
