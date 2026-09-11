#!/usr/bin/env node
// test-generation-hook.cjs - PostToolUse (Edit|Write) hook.
// Detects source files lacking matching test files — logs a "test gap" signal.
// Observer-only: never blocks. Exit 0 always.

'use strict';

try {
  const fs = require('fs');
  const path = require('path');

  const { loadHarnessPolicy, resolveMetricPath, appendJsonl } = require('./lib/harness-policy-loader.cjs');
  const { isHookEnabled } = require('./lib/bk-config-utils.cjs');
  const { resolveProjectRoot } = require('./lib/resolve-project-root.cjs');

  // Skip env flag
  if (process.env.BK_TEST_GEN_SKIP === '1') process.exit(0);

  // Check hook enabled
  if (!isHookEnabled('test-generation-hook')) process.exit(0);

  const policy = loadHarnessPolicy();
  const cfg = policy.test_generation || {};
  if (!cfg.enabled) process.exit(0);

  const LANG_EXTS = {
    swift: ['.swift'],
    kotlin: ['.kt'],
    dart: ['.dart'],
    typescript: ['.ts', '.tsx'],
    javascript: ['.js', '.jsx']
  };

  const DEFAULT_EXCLUDE = [
    '**/node_modules/**', '**/dist/**', '**/build/**', '**/*.generated.*'
  ];

  const LANGUAGES = cfg.languages || ['swift', 'kotlin', 'dart', 'typescript', 'javascript'];
  const EXCLUDE_PATTERNS = cfg.exclude_patterns || DEFAULT_EXCLUDE;

  /**
   * Convert a glob-like pattern to a RegExp.
   * Handles ** and * wildcards only.
   */
  function globToRegex(pattern) {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '{{DSTAR}}')
      .replace(/\*/g, '[^/]*')
      .replace(/{{DSTAR}}/g, '.*');
    return new RegExp(escaped);
  }

  /**
   * Check if a file path matches any exclude pattern.
   */
  function isExcluded(filePath) {
    return EXCLUDE_PATTERNS.some(p => globToRegex(p).test(filePath));
  }

  /**
   * Determine the language of a source file by extension.
   * Returns null if not a tracked language.
   */
  function detectLanguage(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    for (const lang of LANGUAGES) {
      const exts = LANG_EXTS[lang] || [];
      if (exts.includes(ext)) return lang;
    }
    return null;
  }

  /**
   * Check if a matching test file exists for the given source file.
   * Heuristic: looks for:
   *   - <basename>Test.<ext> or <basename>_test.<ext> anywhere in project
   *   - same basename in any __tests__/ directory
   * Uses filesystem checks relative to project root.
   */
  function hasMatchingTestFile(sourceFile, projectRoot) {
    try {
      const ext = path.extname(sourceFile);
      const base = path.basename(sourceFile, ext);
      const dir = path.dirname(sourceFile);

      // Check 1: __tests__/<base>* in same directory tree
      const testDir = path.join(dir, '__tests__');
      if (fs.existsSync(testDir)) {
        const files = fs.readdirSync(testDir).filter(f => f.startsWith(base));
        if (files.length > 0) return true;
      }

      // Check 2: sibling <base>Test.* or <base>_test.*
      const sibling1 = path.join(dir, `${base}Test${ext}`);
      const sibling2 = path.join(dir, `${base}_test${ext}`);
      if (fs.existsSync(sibling1) || fs.existsSync(sibling2)) return true;

      // Check 3: scan project root shallowly for test files matching basename
      // (avoid deep walk — keep fast; look one extra level up)
      const parentDir = path.dirname(dir);
      const parentTestDir = path.join(parentDir, '__tests__');
      if (fs.existsSync(parentTestDir)) {
        const files = fs.readdirSync(parentTestDir).filter(f => f.startsWith(base));
        if (files.length > 0) return true;
      }

      return false;
    } catch {
      return true; // fail-open: assume test exists to avoid noise
    }
  }

  async function main() {
    // Read stdin — use fd 0 for compat
    let raw = '';
    try {
      raw = fs.readFileSync(0, 'utf8');
    } catch { /* no stdin — fail-open */ }

    let input = {};
    try { input = JSON.parse(raw || '{}'); } catch { /* malformed — fail-open */ }

    const projectRoot = resolveProjectRoot();
    if (!projectRoot) process.exit(0);

    // Extract the file being edited/written
    const toolInput = input.tool_input || {};
    const filePath = toolInput.file_path || toolInput.path || '';
    if (!filePath) process.exit(0);

    // Resolve to absolute path if relative
    const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(projectRoot, filePath);

    // Check exclusions
    if (isExcluded(absPath)) process.exit(0);
    if (isExcluded(filePath)) process.exit(0);

    // Detect language
    const language = detectLanguage(absPath);
    if (!language) process.exit(0);

    // Skip if it's already a test file itself
    const base = path.basename(absPath).toLowerCase();
    if (base.includes('test') || base.includes('spec') || absPath.includes('__tests__')) {
      process.exit(0);
    }

    // Check for matching test file
    if (hasMatchingTestFile(absPath, projectRoot)) process.exit(0);

    // Log test gap
    const gapFile = resolveMetricPath('.bk-metrics/test-gaps.jsonl', projectRoot);
    const entry = {
      timestamp: new Date().toISOString(),
      file: filePath,
      language,
      reason: `No test file found for ${path.basename(absPath)}`
    };
    appendJsonl(gapFile, entry);

    process.stderr.write(
      `[test-generation-hook] test_gap: ${filePath} (${language}) — no matching test file found\n`
    );

    process.exit(0);
  }

  main().catch(() => process.exit(0));
} catch (e) {
  try {
    process.stderr.write(`[test-generation-hook] CRASH (fail-open): ${e.message}\n`);
  } catch { /* ignore */ }
  process.exit(0);
}
