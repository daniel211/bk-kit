'use strict';
/**
 * junit-writer.cjs — Lightweight JUnit XML emitter (no external deps).
 *
 * Generates JUnit-compatible XML for CI systems (GitHub Actions, Jenkins, etc.)
 * One testcase per rule check; failures map to <failure> elements.
 */

/**
 * Escape special XML characters in attribute values and text content.
 * @param {string} str
 * @returns {string}
 */
function escapeXml(str) {
  if (typeof str !== 'string') str = String(str ?? '');
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Build a <testcase> element.
 *
 * @param {{ name: string, classname?: string, time?: number, failure?: string, skipped?: boolean }} tc
 * @returns {string}
 */
function buildTestCase(tc) {
  const name = escapeXml(tc.name || 'unnamed');
  const classname = escapeXml(tc.classname || 'harness');
  const time = typeof tc.time === 'number' ? tc.time.toFixed(3) : '0.000';

  let inner = '';
  if (tc.skipped) {
    inner = '  <skipped/>';
  } else if (tc.failure) {
    inner = `  <failure message=${JSON.stringify(escapeXml(tc.failure.slice(0, 200)))}>${escapeXml(tc.failure)}</failure>`;
  }

  if (inner) {
    return `  <testcase name="${name}" classname="${classname}" time="${time}">\n  ${inner}\n  </testcase>`;
  }
  return `  <testcase name="${name}" classname="${classname}" time="${time}"/>`;
}

/**
 * Build a <testsuite> element.
 *
 * @param {{ name: string, tests: object[], time?: number, timestamp?: string }} suite
 * @returns {string}
 */
function buildTestSuite(suite) {
  const name = escapeXml(suite.name || 'Harness CI');
  const tests = suite.tests || [];
  const failures = tests.filter(t => t.failure && !t.skipped).length;
  const skipped  = tests.filter(t => t.skipped).length;
  const time = typeof suite.time === 'number' ? suite.time.toFixed(3) : '0.000';
  const timestamp = suite.timestamp || new Date().toISOString();

  const cases = tests.map(t => buildTestCase(t)).join('\n');

  return [
    `<testsuite name="${name}" tests="${tests.length}" failures="${failures}" skipped="${skipped}" time="${time}" timestamp="${escapeXml(timestamp)}">`,
    cases,
    `</testsuite>`
  ].join('\n');
}

/**
 * Emit JUnit XML string from an array of test suites.
 *
 * @param {Array<{ name: string, tests: object[], time?: number }>} testSuites
 * @returns {string} complete JUnit XML document
 */
function writeJunit(testSuites) {
  if (!Array.isArray(testSuites)) testSuites = [testSuites];

  const totalTests    = testSuites.reduce((s, ts) => s + (ts.tests || []).length, 0);
  const totalFailures = testSuites.reduce((s, ts) => {
    return s + (ts.tests || []).filter(t => t.failure && !t.skipped).length;
  }, 0);
  const totalTime = testSuites.reduce((s, ts) => s + (ts.time || 0), 0);

  const suiteXml = testSuites.map(ts => buildTestSuite(ts)).join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites tests="${totalTests}" failures="${totalFailures}" time="${totalTime.toFixed(3)}">`,
    suiteXml,
    '</testsuites>'
  ].join('\n');
}

/**
 * Convert aggregated findings + summary into JUnit test suites structure.
 *
 * @param {{ summary: object, findings: object[], archChecks?: object[] }} report
 * @returns {object[]} testSuites array
 */
function findingsToTestSuites(report) {
  const { summary = {}, findings = [], archChecks = [] } = report;
  const startTs = Date.now();

  // Suite 1: arch-fitness checks
  const archTests = archChecks.map(check => ({
    name: check.rule || check.name || 'arch-check',
    classname: `arch.${check.platform || 'common'}`,
    time: 0,
    failure: check.passed ? null : (check.message || 'Rule failed')
  }));

  // Suite 2: findings per category
  const findingTests = findings.map((f, i) => ({
    name: `${f.category || 'finding'}[${i}]: ${(f.message || '').slice(0, 80)}`,
    classname: `findings.${f.source || 'unknown'}`,
    time: 0,
    failure: f.severity === 'error' ? (f.message || 'Error finding') : null
  }));

  // Suite 3: budget check
  const budgetStatus = report.budget || {};
  const budgetTests = [{
    name: 'cost-budget',
    classname: 'budget',
    time: 0,
    failure: budgetStatus.exceeds
      ? `Budget exceeded: $${budgetStatus.currentUsd?.toFixed(4)} / $${budgetStatus.budgetUsd?.toFixed(2)}`
      : null
  }];

  const elapsed = (Date.now() - startTs) / 1000;

  return [
    {
      name: 'Harness Arch-Fitness',
      tests: archTests.length ? archTests : [{ name: 'no-arch-checks', classname: 'arch', time: 0 }],
      time: elapsed
    },
    {
      name: 'Harness Findings',
      tests: findingTests.length ? findingTests : [{ name: 'no-findings', classname: 'findings', time: 0 }],
      time: elapsed
    },
    {
      name: 'Harness Budget',
      tests: budgetTests,
      time: elapsed
    }
  ];
}

module.exports = { writeJunit, buildTestCase, buildTestSuite, escapeXml, findingsToTestSuites };
