#!/usr/bin/env node
/**
 * design-spec-diff.mjs — Cross-check two design.md files produced by different engines.
 *
 * `--engine dual` runs both the claude trio and agy over the same screen and writes to
 * separate paths. This script says where they disagree.
 *
 * It does NOT merge and does NOT pick a winner. The claude spec stays canonical; agy plays
 * the reviewer. Two engines writing one file means the slower one silently overwrites the
 * other — the lesson bk-review's dual mode already paid for.
 *
 * Usage:
 *   node design-spec-diff.mjs --a <design.md> --b <design.agy.md> [--out <report.md>]
 *                             [--label-a claude] [--label-b agy]
 *
 * Exit codes:
 *   0  compared; no CRITICAL differences
 *   4  compared; CRITICAL differences found (caller should gate on this)
 *   1  could not compare
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// A Figma node id: plain, or a compound INSTANCE path.
const NODE_ID = /\bI?\d+:\d+(?:;\d+:\d+)*\b/g;
// A design token reference, e.g. $color-primary.
const TOKEN = /\$[a-zA-Z][\w.-]*/g;
// A pixel measurement, e.g. h=44, 16px. The unit is optional and captured separately so
// "44" and "44px" compare equal — they are the same measurement written two ways.
const MEASURE = /\b(\d+(?:\.\d+)?)(?:px)?\b/g;

/**
 * Spacing differences below this are noise: Figma reports fractional sizes and the two
 * engines round them differently. Above it, someone read the design differently.
 */
export const SPACING_TOLERANCE_PX = 2;

/**
 * Split a design.md into its nine numbered sections.
 *
 * @param {string} markdown
 * @returns {Map<string, string>} section number → body
 */
export function splitSections(markdown) {
  const sections = new Map();
  const lines = String(markdown).split('\n');
  let current = null;
  let buffer = [];
  for (const line of lines) {
    const heading = line.match(/^##\s+(\d)\.\s*(.*)$/);
    if (heading) {
      if (current) sections.set(current, buffer.join('\n'));
      current = heading[1];
      buffer = [];
    } else if (current) {
      buffer.push(line);
    }
  }
  if (current) sections.set(current, buffer.join('\n'));
  return sections;
}

/**
 * All matches of a pattern in a text, as a Set.
 *
 * @param {string} text
 * @param {RegExp} pattern
 * @returns {Set<string>}
 */
function collect(text, pattern) {
  return new Set(String(text).match(pattern) || []);
}

/**
 * The numeric measurements in a section, with node ids removed first.
 *
 * @param {string} text
 * @returns {number[]}
 */
function measurements(text) {
  const withoutIds = String(text).replace(NODE_ID, ' ');
  return [...withoutIds.matchAll(MEASURE)]
    .map((match) => Number(match[1]))
    .filter((n) => !Number.isNaN(n))
    .sort((x, y) => x - y);
}

/**
 * Members of `a` absent from `b`.
 *
 * @param {Set<string>} a
 * @param {Set<string>} b
 * @returns {string[]}
 */
function missingFrom(a, b) {
  return [...a].filter((item) => !b.has(item));
}

/**
 * Compare two design specs.
 *
 * Severity reflects what a difference costs downstream:
 *   CRITICAL — a missing section, or a node id one engine saw and the other did not. Both
 *              mean generated code will address the wrong thing, or nothing.
 *   WARN     — token names or measurements that disagree. The screen still builds; it
 *              builds slightly wrong.
 *   INFO     — everything else, including prose. Two models describing the same frame in
 *              different words is expected, not a finding.
 *
 * @param {string} specA
 * @param {string} specB
 * @param {{labelA?: string, labelB?: string}} [labels]
 * @returns {{findings: object[], critical: number, warn: number, info: number}}
 */
export function diffSpecs(specA, specB, { labelA = 'A', labelB = 'B' } = {}) {
  const a = splitSections(specA);
  const b = splitSections(specB);
  const findings = [];

  for (const num of ['1', '2', '3', '4', '5', '6', '7', '8', '9']) {
    const hasA = a.has(num);
    const hasB = b.has(num);
    if (!hasA || !hasB) {
      findings.push({
        severity: 'CRITICAL',
        section: num,
        detail: `Section ${num} present in ${hasA ? labelA : labelB} but missing from `
          + `${hasA ? labelB : labelA}.`
      });
      continue;
    }

    const textA = a.get(num);
    const textB = b.get(num);

    const idsA = collect(textA, NODE_ID);
    const idsB = collect(textB, NODE_ID);
    const onlyA = missingFrom(idsA, idsB);
    const onlyB = missingFrom(idsB, idsA);
    if (onlyA.length || onlyB.length) {
      findings.push({
        severity: 'CRITICAL',
        section: num,
        detail: `Node ids disagree. Only in ${labelA}: ${onlyA.join(', ') || '—'}. `
          + `Only in ${labelB}: ${onlyB.join(', ') || '—'}.`
      });
    }

    const tokensOnlyA = missingFrom(collect(textA, TOKEN), collect(textB, TOKEN));
    const tokensOnlyB = missingFrom(collect(textB, TOKEN), collect(textA, TOKEN));
    if (tokensOnlyA.length || tokensOnlyB.length) {
      findings.push({
        severity: 'WARN',
        section: num,
        detail: `Design tokens differ. Only in ${labelA}: ${tokensOnlyA.join(', ') || '—'}. `
          + `Only in ${labelB}: ${tokensOnlyB.join(', ') || '—'}.`
      });
    }

    // Measurements compare as numbers, and node ids are stripped first: an id like
    // 20715:112652 is full of digits that are not measurements, and any real disagreement
    // between ids has already been reported above as CRITICAL.
    const numsA = measurements(textA);
    const numsB = measurements(textB);
    const unmatched = numsA.filter((n) => !numsB.some((m) => Math.abs(n - m) <= SPACING_TOLERANCE_PX));
    if (unmatched.length) {
      findings.push({
        severity: 'WARN',
        section: num,
        detail: `Measurements in ${labelA} with no match within ${SPACING_TOLERANCE_PX}px in `
          + `${labelB}: ${unmatched.slice(0, 12).join(', ')}`
          + (unmatched.length > 12 ? ` (+${unmatched.length - 12} more)` : '')
      });
    }
  }

  return {
    findings,
    critical: findings.filter((f) => f.severity === 'CRITICAL').length,
    warn: findings.filter((f) => f.severity === 'WARN').length,
    info: findings.filter((f) => f.severity === 'INFO').length
  };
}

/**
 * Render the comparison as a Markdown report.
 *
 * @param {object} result
 * @param {object} meta
 * @returns {string}
 */
export function renderReport(result, { fileA, fileB, labelA, labelB }) {
  const lines = [
    '# Engine cross-check report',
    '',
    `- \`${labelA}\` (canonical): ${fileA}`,
    `- \`${labelB}\` (reviewer):  ${fileB}`,
    '',
    `**${result.critical} CRITICAL · ${result.warn} WARN**`,
    '',
    'The canonical spec is unchanged by this report. A CRITICAL row means the two engines',
    'read the design differently in a way that changes generated code — resolve it before',
    'building. A WARN is worth a look and rarely blocking.',
    ''
  ];
  if (result.findings.length === 0) {
    lines.push('Both engines produced equivalent specs. Nothing to resolve.');
    return lines.join('\n') + '\n';
  }
  lines.push('| Severity | Section | Detail |', '|---|---|---|');
  for (const f of result.findings) {
    lines.push(`| ${f.severity} | ${f.section} | ${f.detail.replace(/\|/g, '\\|')} |`);
  }
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const args = process.argv.slice(2);
  const opts = { a: null, b: null, out: null, labelA: 'claude', labelB: 'agy' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--a') opts.a = args[++i];
    else if (args[i] === '--b') opts.b = args[++i];
    else if (args[i] === '--out') opts.out = args[++i];
    else if (args[i] === '--label-a') opts.labelA = args[++i];
    else if (args[i] === '--label-b') opts.labelB = args[++i];
  }

  if (!opts.a || !opts.b) {
    console.error('Usage: design-spec-diff.mjs --a <design.md> --b <design.agy.md> [--out <report.md>]');
    process.exit(1);
  }
  for (const file of [opts.a, opts.b]) {
    if (!existsSync(file)) {
      console.error(`❌ Not found: ${file}`);
      process.exit(1);
    }
  }

  const result = diffSpecs(readFileSync(opts.a, 'utf8'), readFileSync(opts.b, 'utf8'),
    { labelA: opts.labelA, labelB: opts.labelB });
  const report = renderReport(result, {
    fileA: opts.a, fileB: opts.b, labelA: opts.labelA, labelB: opts.labelB
  });

  if (opts.out) {
    mkdirSync(dirname(opts.out), { recursive: true });
    writeFileSync(opts.out, report, 'utf8');
    console.log(`[design-spec-diff] ${result.critical} CRITICAL, ${result.warn} WARN → ${opts.out}`);
  } else {
    process.stdout.write(report);
  }

  process.exit(result.critical > 0 ? 4 : 0);
}
