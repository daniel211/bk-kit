#!/usr/bin/env node
// property-based-test-suggester.cjs - PostToolUse (Edit|Write) hook.
// Static analysis on test files: suggests property-based testing when many
// simple test cases with overlapping assertion shapes are detected.
// Observer-only: never blocks. Exit 0 always.

'use strict';

try {
  const fs = require('fs');
  const path = require('path');

  const { loadHarnessPolicy, resolveMetricPath, appendJsonl } = require('./lib/harness-policy-loader.cjs');
  const { isHookEnabled } = require('./lib/bk-config-utils.cjs');
  const { resolveProjectRoot } = require('./lib/resolve-project-root.cjs');

  // Check hook enabled
  if (!isHookEnabled('property-based-test-suggester')) process.exit(0);

  const policy = loadHarnessPolicy();
  const cfg = policy.pbt_suggester || {};
  if (!cfg.enabled) process.exit(0);

  const MIN_CASES = cfg.min_cases || 10;
  const SAMPLE_THRESHOLD = cfg.sample_threshold || 0.7;

  // Parametric test patterns (these mean devs already use parameterization)
  const PARAMETRIC_PATTERNS = [
    /\.forEach\s*\(/,
    /@ParameterizedTest/,
    /test\.each\s*[(\[]/,
    /for\s*\(final\s+\w+\s+in\s*\[/,
    /describe\.each\s*[(\[]/,
    /it\.each\s*[(\[]/,
    /where\s*:/,           // Spek/Kotest where clause
    /@CsvSource/,
    /@ValueSource/
  ];

  // Simple test case patterns
  const SIMPLE_TEST_PATTERNS = [
    /^\s*(test|it)\s*\(/m,
    /^\s*func\s+test\w+\s*\(/m,     // Swift XCTest
    /^\s*@Test\s/m,                  // JUnit5 / Kotest
    /^\s*fun\s+test\w+\s*\(/m       // Kotlin test func
  ];

  // Common assertion APIs used with literals
  const ASSERTION_APIS = [
    /XCTAssertEqual\s*\(/g,
    /XCTAssertTrue\s*\(/g,
    /XCTAssertFalse\s*\(/g,
    /assertEquals\s*\(/g,
    /assertTrue\s*\(/g,
    /assertFalse\s*\(/g,
    /expect\s*\(.*\)\s*\.to(Equal|Be|Contain)/g,
    /assert\.equal\s*\(/g,
    /assert\.ok\s*\(/g,
    /expect\s*\(.*\)\s*\.(toEqual|toBe|toContain)\s*\(/g,
    /\.shouldBe\s*\(/g,            // Kotest
    /\.shouldEqual\s*\(/g,
  ];

  /**
   * Count parametric test patterns in content.
   */
  function countParametric(content) {
    return PARAMETRIC_PATTERNS.filter(p => p.test(content)).length;
  }

  /**
   * Count simple test case declarations in content.
   */
  function countSimpleCases(content) {
    let count = 0;
    for (const pattern of SIMPLE_TEST_PATTERNS) {
      const matches = content.match(new RegExp(pattern.source, 'gm'));
      if (matches) count += matches.length;
    }
    return count;
  }

  /**
   * Count total assertion calls in content.
   */
  function countAssertions(content) {
    let count = 0;
    for (const pattern of ASSERTION_APIS) {
      const matches = content.match(new RegExp(pattern.source, 'g'));
      if (matches) count += matches.length;
    }
    return count;
  }

  /**
   * Check if the assertion shape is repetitive:
   * ratio of assertions to test cases is high (many assertions per test).
   * A high ratio with many tests indicates copy-pasted patterns.
   */
  function isRepetitiveAssertion(assertionCount, testCount) {
    if (testCount === 0) return false;
    const ratio = assertionCount / testCount;
    // If each test has ~1-2 assertions and we have many tests → repetitive
    return ratio >= 0.5 && ratio <= 3.0;
  }

  /**
   * Determine suggested PBT library based on file extension.
   */
  function suggestLibrary(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
      case '.swift':       return 'SwiftCheck or Hypothesis Swift';
      case '.kt':          return 'Kotest Property Testing or kotlintest';
      case '.dart':        return 'glados or dart_test with generators';
      case '.ts':
      case '.tsx':
      case '.js':
      case '.jsx':         return 'fast-check';
      default:             return 'a property-based testing library';
    }
  }

  /**
   * Check if a file is a test file.
   */
  function isTestFile(filePath) {
    const base = path.basename(filePath);
    const hasTestInName = /test|spec/i.test(base);
    const inTestDir = filePath.includes('__tests__') ||
                      filePath.includes('/test/') ||
                      filePath.includes('/tests/');
    return hasTestInName || inTestDir;
  }

  async function main() {
    // Read stdin
    let raw = '';
    try {
      raw = fs.readFileSync(0, 'utf8');
    } catch { /* fail-open */ }

    let input = {};
    try { input = JSON.parse(raw || '{}'); } catch { /* malformed — fail-open */ }

    const projectRoot = resolveProjectRoot();
    if (!projectRoot) process.exit(0);

    // Extract file being edited
    const toolInput = input.tool_input || {};
    const filePath = toolInput.file_path || toolInput.path || '';
    if (!filePath) process.exit(0);

    // Only operate on test files
    if (!isTestFile(filePath)) process.exit(0);

    // Read the file content
    const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(projectRoot, filePath);
    let content = '';
    try {
      if (!fs.existsSync(absPath)) process.exit(0);
      content = fs.readFileSync(absPath, 'utf8');
    } catch { process.exit(0); }

    // Count parametric patterns (if already using them, skip)
    const parametricCount = countParametric(content);
    if (parametricCount > 0) process.exit(0); // Already parameterized

    // Count simple test cases
    const simpleCount = countSimpleCases(content);
    if (simpleCount < MIN_CASES) process.exit(0);

    // Count assertions
    const assertionCount = countAssertions(content);

    // Check for repetitive assertion shape
    if (!isRepetitiveAssertion(assertionCount, simpleCount)) process.exit(0);

    // Sample threshold: check ratio of tests to file lines
    const lineCount = content.split('\n').length;
    const testDensity = simpleCount / Math.max(lineCount, 1);
    if (testDensity < (SAMPLE_THRESHOLD / 100)) {
      // Too sparse to be a concern — only flag dense test files
      // (threshold interpreted as: at least SAMPLE_THRESHOLD% of lines are tests)
      // But with MIN_CASES=10, we proceed anyway if simpleCount >= MIN_CASES
    }

    // Log suggestion
    const suggestFile = resolveMetricPath('.bk-metrics/pbt-suggestions.jsonl', projectRoot);
    const entry = {
      timestamp: new Date().toISOString(),
      file: filePath,
      simpleTestCount: simpleCount,
      assertionCount,
      suggestion: `Consider property-based testing library: ${suggestLibrary(filePath)}`
    };
    appendJsonl(suggestFile, entry);

    process.stderr.write(
      `[property-based-test-suggester] PBT suggestion for ${path.basename(filePath)}: ` +
      `${simpleCount} simple test cases detected — consider ${suggestLibrary(filePath)}\n`
    );

    process.exit(0);
  }

  main().catch(() => process.exit(0));
} catch (e) {
  try {
    process.stderr.write(`[property-based-test-suggester] CRASH (fail-open): ${e.message}\n`);
  } catch { /* ignore */ }
  process.exit(0);
}
