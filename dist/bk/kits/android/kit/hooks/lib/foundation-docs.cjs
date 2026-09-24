/**
 * foundation-docs.cjs — Where the foundation docs live, whether a project has them, and how
 * much of one to hand an agent.
 *
 * One definition, because there used to be three. /bk-bootstrap writes `bk/docs/foundation/`
 * (subagent-init, project-profile and bootstrap-quality-gate all look there), but session-init
 * checked `<root>/docs/foundation/` in two places. In the iOS field repo (X-Game-Pro, 0.10.1),
 * with seven foundation docs present, every session printed "Foundation: no" and
 * "⚠️ Foundation docs: not found (run /bk-bootstrap)" and exported BK_HAS_FOUNDATION=false.
 */

'use strict';

const fs = require('fs');
const path = require('path');

/** Project-relative location of the foundation docs, as the skills and agents name it. */
const FOUNDATION_REL = 'bk/docs/foundation';

/**
 * @param {string} root - Project root
 * @returns {string} absolute path of bk/docs/foundation/
 */
function foundationDir(root) {
  return path.join(root, ...FOUNDATION_REL.split('/'));
}

/**
 * A project "has foundation docs" when bk/docs/foundation/ holds at least one markdown doc of
 * its own. `_raw/` (bootstrap's scratch input) and hidden files do not count: a bootstrap that
 * died after collecting raw notes has not produced anything an agent can read.
 *
 * @param {string} root - Project root
 * @returns {boolean}
 */
function hasFoundationDocs(root) {
  try {
    return fs.readdirSync(foundationDir(root), { withFileTypes: true })
      .some((e) => e.isFile() && !e.name.startsWith('.') && e.name.toLowerCase().endsWith('.md'));
  } catch {
    return false;
  }
}

/**
 * The smallest slice of a first section worth injecting. A preamble that eats nearly the whole
 * budget must not leave the section a dozen characters, so it may run the total past the budget
 * by up to this much.
 */
const MIN_FIRST_SECTION_CHARS = 240;

const FENCE_RE = /^\s*(```|~~~)/;

/** Stands in for a code block that does not fit — the prose after it usually still does. */
const OMITTED_BLOCK = '(code block omitted)';

/**
 * Split markdown into units that may not be cut: a fenced code block (opening line through its
 * closing line, or to the end if it never closes) is one unit, every other line is its own.
 * @param {string} text
 * @returns {string[]} each unit's text, without its trailing newline
 */
function lineUnits(text) {
  const units = [];
  let fence = null;
  for (const line of text.split('\n')) {
    if (fence) {
      fence.push(line);
      if (FENCE_RE.test(line)) { units.push(fence.join('\n')); fence = null; }
    } else if (FENCE_RE.test(line)) {
      fence = [line];
    } else {
      units.push(line);
    }
  }
  if (fence) units.push(fence.join('\n'));
  return units;
}

/**
 * Cut `text` to at most `limit` characters at a line boundary, never inside a code fence.
 *
 * Cutting inside a fence hands the agent half a diagram and an unclosed block that swallows
 * whatever the prompt says next. A fenced block that does not fit is replaced by a one-line
 * placeholder and filling continues after it: in X-Game-Pro's architecture.md the rules a
 * reviewer needs ("Data cannot import from Presentation") sit right below a 20-line box diagram.
 *
 * @param {string} text
 * @param {number} limit
 * @returns {string}
 */
function truncateAtLine(text, limit) {
  const kept = [];
  let used = 0;
  for (const unit of lineUnits(text)) {
    const isBlock = FENCE_RE.test(unit);
    const piece = isBlock && used + unit.length + 1 > limit ? OMITTED_BLOCK : unit;
    if (used + piece.length + 1 > limit) break;
    // Two placeholders in a row say nothing the first did not.
    if (piece === OMITTED_BLOCK && kept.length && kept[kept.length - 1] === OMITTED_BLOCK) continue;
    kept.push(piece);
    used += piece.length + 1;
  }
  return kept.join('\n');
}

/**
 * Extract whole `## ` sections of a markdown doc up to a character budget.
 *
 * Whole sections, because a half-section reads as the full rule. The one exception is the first
 * real section: the doc's preamble (title, status lines) is chunk 0 of the split, so when the
 * first `## ` section alone overflowed the budget the old version stopped right there and the
 * agent received only the title and three status lines. X-Game-Pro's architecture.md is exactly
 * that shape — `# System Architecture`, three bold status lines, then a long
 * `## Architectural Style` with a box diagram — and every reviewer got the title and nothing else.
 * Now the first section is always included, truncated at a line boundary with a marker that says
 * where the rest is.
 *
 * @param {string} content - Markdown content
 * @param {number} maxChars - Approximate char budget (~4 chars/token)
 * @param {string} [sourceRel] - Project-relative path named in the truncation marker
 * @returns {string}
 */
function extractSections(content, maxChars, sourceRel) {
  const chunks = String(content || '').split(/^(?=## )/m);
  const marker = `\n…(truncated, see ${sourceRel || FOUNDATION_REL + '/'})\n`;
  let result = '';
  let hasSection = false;

  for (const chunk of chunks) {
    const isSection = chunk.startsWith('## ');
    if (result.length + chunk.length <= maxChars) {
      result += chunk;
      if (isSection) hasSection = true;
      continue;
    }
    if (hasSection) break;                       // a whole section already landed — stop clean
    if (!isSection) {                            // an oversized preamble: keep its head only
      result += truncateAtLine(chunk, maxChars) + '\n\n';
      continue;
    }
    const room = Math.max(maxChars - result.length, MIN_FIRST_SECTION_CHARS);
    result += truncateAtLine(chunk, room).replace(/\s+$/, '') + '\n' + marker;
    hasSection = true;
    break;
  }
  return result;
}

module.exports = {
  FOUNDATION_REL,
  foundationDir,
  hasFoundationDocs,
  extractSections,
  truncateAtLine
};
