/**
 * design-spec-diff.test.mjs — Guards what `--engine dual` actually reports.
 *
 * The point of dual mode is a second opinion, not a second file nobody reads. That only
 * works if severity means something: a node id the two engines disagree on changes what
 * gets generated, while two models describing the same frame in different prose does not.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitSections, diffSpecs, renderReport, SPACING_TOLERANCE_PX }
  from '../design-spec-diff.mjs';

/** Build a nine-section spec, overriding individual sections. */
function spec(overrides = {}) {
  const body = {};
  for (let i = 1; i <= 9; i++) body[i] = `Section ${i} body.`;
  Object.assign(body, overrides);
  return Object.entries(body).map(([n, text]) => `## ${n}. Heading\n\n${text}\n`).join('\n');
}

test('splitSections: finds all nine numbered sections and keeps their bodies', () => {
  const sections = splitSections(spec());
  assert.equal(sections.size, 9);
  assert.match(sections.get('4'), /Section 4 body/);
});

test('diffSpecs: identical specs produce no findings at all', () => {
  const result = diffSpecs(spec(), spec());
  assert.deepEqual(result.findings, []);
  assert.equal(result.critical, 0);
});

test('diffSpecs: a missing section is CRITICAL and names which side lacks it', () => {
  const truncated = spec();
  const withoutNine = truncated.slice(0, truncated.indexOf('## 9.'));
  const result = diffSpecs(spec(), withoutNine, { labelA: 'claude', labelB: 'agy' });
  const finding = result.findings.find((f) => f.section === '9');
  assert.equal(finding.severity, 'CRITICAL');
  assert.match(finding.detail, /present in claude but missing from agy/);
});

test('diffSpecs: a node id only one engine saw is CRITICAL', () => {
  const a = spec({ 8: 'Export ic-back [20715:112652]' });
  const b = spec({ 8: 'Export ic-back [20715:999999]' });
  const result = diffSpecs(a, b, { labelA: 'claude', labelB: 'agy' });
  const finding = result.findings.find((f) => f.severity === 'CRITICAL');
  assert.match(finding.detail, /20715:112652/);
  assert.match(finding.detail, /20715:999999/);
});

test('diffSpecs: compound INSTANCE paths are compared whole, not by their parts', () => {
  const a = spec({ 8: 'ic-x [I20715:114058;1813:23687]' });
  const b = spec({ 8: 'ic-x [I20715:114058;1813:23687]' });
  assert.equal(diffSpecs(a, b).critical, 0);
});

test('diffSpecs: differing design tokens are WARN, not CRITICAL — the screen still builds', () => {
  const a = spec({ 4: 'Primary: $color-primary' });
  const b = spec({ 4: 'Primary: $color-brand' });
  const result = diffSpecs(a, b);
  assert.equal(result.critical, 0);
  assert.equal(result.warn, 1);
  assert.equal(result.findings[0].severity, 'WARN');
});

test(`diffSpecs: measurements within ${SPACING_TOLERANCE_PX}px are not a finding`, () => {
  const a = spec({ 2: 'header h=44' });
  const b = spec({ 2: 'header h=45' });
  assert.equal(diffSpecs(a, b).findings.length, 0, 'rounding noise must not become a finding');
});

test('diffSpecs: "44" and "44px" are the same measurement written two ways', () => {
  const a = spec({ 2: 'header h=44' });
  const b = spec({ 2: 'header h=44px' });
  assert.equal(diffSpecs(a, b).findings.length, 0);
});

test('diffSpecs: a real spacing disagreement is reported', () => {
  const a = spec({ 2: 'padding 16' });
  const b = spec({ 2: 'padding 32' });
  const result = diffSpecs(a, b);
  assert.equal(result.warn, 1);
  assert.match(result.findings[0].detail, /16/);
});

test('diffSpecs: differing prose alone is not a finding', () => {
  const a = spec({ 1: 'The dashboard screen shows account balances.' });
  const b = spec({ 1: 'Screen displaying the balances of a user account.' });
  assert.equal(diffSpecs(a, b).findings.length, 0);
});

test('renderReport: an empty diff says so plainly instead of printing an empty table', () => {
  const report = renderReport(diffSpecs(spec(), spec()),
    { fileA: 'a.md', fileB: 'b.md', labelA: 'claude', labelB: 'agy' });
  assert.match(report, /Both engines produced equivalent specs/);
  assert.doesNotMatch(report, /\| Severity \|/);
});

test('renderReport: escapes pipes so a finding cannot break the table', () => {
  const result = diffSpecs(spec({ 4: '$a | $b' }), spec({ 4: '$c' }));
  const report = renderReport(result, { fileA: 'a', fileB: 'b', labelA: 'x', labelB: 'y' });
  for (const line of report.split('\n').filter((l) => l.startsWith('| WARN'))) {
    assert.equal(line.split(/(?<!\\)\|/).length - 1, 4, 'a row must have exactly 4 delimiters');
  }
});

test('renderReport: states that the canonical spec is untouched', () => {
  const report = renderReport(diffSpecs(spec(), spec({ 4: '$other' })),
    { fileA: 'a.md', fileB: 'b.md', labelA: 'claude', labelB: 'agy' });
  assert.match(report, /canonical spec is unchanged/);
});
