#!/usr/bin/env node
// ui-snapshot-compare.cjs - PostToolUse (Edit|Write) hook.
// Checks for presence of snapshot test infrastructure when UI files are edited.
// Emits ui_snapshot_gap signal if snapshot infra or goldens are missing.
// Observer-only: never blocks. Exit 0 always.

'use strict';

try {
  const fs = require('fs');
  const path = require('path');

  const { loadHarnessPolicy, resolveMetricPath, appendJsonl, trackRedSignal } = require('./lib/harness-policy-loader.cjs');
  const { isHookEnabled } = require('./lib/bk-config-utils.cjs');
  const { resolveProjectRoot } = require('./lib/resolve-project-root.cjs');

  // Check hook enabled
  if (!isHookEnabled('ui-snapshot-compare')) process.exit(0);

  const policy = loadHarnessPolicy();
  const cfg = policy.ui_snapshot || {};
  if (!cfg.enabled) process.exit(0);

  const PLATFORMS = cfg.platforms || ['ios', 'android', 'flutter'];

  // UI file matchers
  const UI_PATTERNS = [
    { regex: /View\.swift$/i,   platform: 'ios' },
    { regex: /Screen\.kt$/i,    platform: 'android' },
    { regex: /Widget\.dart$/i,  platform: 'flutter' },
    { regex: /\.jsx$/i,         platform: 'web' },
    { regex: /\.tsx$/i,         platform: 'web' }
  ];

  /**
   * Detect the platform for a UI file.
   * Returns null if not a UI file.
   */
  function detectUIFile(filePath) {
    for (const { regex, platform } of UI_PATTERNS) {
      if (regex.test(filePath)) return platform;
    }
    return null;
  }

  /**
   * Detect iOS snapshot test infrastructure.
   * Looks for XCTest snapshot imports or SnapshotTesting package.
   */
  function detectIOSSnapshotInfra(projectRoot) {
    try {
      // Check Package.swift for SnapshotTesting
      const packageSwift = path.join(projectRoot, 'Package.swift');
      if (fs.existsSync(packageSwift)) {
        const content = fs.readFileSync(packageSwift, 'utf8');
        if (/SnapshotTesting|swift-snapshot-testing/i.test(content)) return true;
      }
      // Check for Podfile with SnapshotTesting
      const podfile = path.join(projectRoot, 'Podfile');
      if (fs.existsSync(podfile)) {
        const content = fs.readFileSync(podfile, 'utf8');
        if (/SnapshotTesting|FBSnapshotTestCase/i.test(content)) return true;
      }
      return false;
    } catch { return false; }
  }

  /**
   * Detect Android snapshot test infrastructure.
   * Looks for Paparazzi or Compose screenshotTest in Gradle files.
   */
  function detectAndroidSnapshotInfra(projectRoot) {
    try {
      const buildGradle = path.join(projectRoot, 'build.gradle');
      const buildGradleKts = path.join(projectRoot, 'build.gradle.kts');
      const appBuildGradle = path.join(projectRoot, 'app', 'build.gradle');
      const appBuildGradleKts = path.join(projectRoot, 'app', 'build.gradle.kts');

      for (const gfile of [buildGradle, buildGradleKts, appBuildGradle, appBuildGradleKts]) {
        if (fs.existsSync(gfile)) {
          const content = fs.readFileSync(gfile, 'utf8');
          if (/paparazzi|screenshotTest|screenshot.test/i.test(content)) return true;
        }
      }
      return false;
    } catch { return false; }
  }

  /**
   * Detect Flutter snapshot test infrastructure.
   * Looks for golden_toolkit or matchesGoldenFile in pubspec or test files.
   */
  function detectFlutterSnapshotInfra(projectRoot) {
    try {
      const pubspec = path.join(projectRoot, 'pubspec.yaml');
      if (fs.existsSync(pubspec)) {
        const content = fs.readFileSync(pubspec, 'utf8');
        if (/golden_toolkit|alchemist/i.test(content)) return true;
      }
      // Check for existing golden files
      const testDir = path.join(projectRoot, 'test');
      if (fs.existsSync(testDir)) {
        const goldensDir = path.join(testDir, 'goldens');
        if (fs.existsSync(goldensDir)) {
          const files = fs.readdirSync(goldensDir);
          if (files.length > 0) return true;
        }
      }
      return false;
    } catch { return false; }
  }

  /**
   * Check snapshot infrastructure for the platform.
   */
  function checkSnapshotInfra(platform, projectRoot) {
    if (!PLATFORMS.includes(platform) && platform !== 'web') return true; // not applicable
    switch (platform) {
      case 'ios':     return detectIOSSnapshotInfra(projectRoot);
      case 'android': return detectAndroidSnapshotInfra(projectRoot);
      case 'flutter': return detectFlutterSnapshotInfra(projectRoot);
      case 'web':     return false; // web snapshot infra not auto-detected; always flag
      default:        return true;
    }
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

    // Detect if this is a UI file
    const platform = detectUIFile(filePath);
    if (!platform) process.exit(0);

    // Check snapshot infrastructure
    const hasInfra = checkSnapshotInfra(platform, projectRoot);

    if (!hasInfra) {
      // Emit finding
      const findingsFile = resolveMetricPath('.bk-metrics/ui-snapshot-findings.jsonl', projectRoot);
      const entry = {
        timestamp: new Date().toISOString(),
        file: filePath,
        platform,
        signal: 'ui_snapshot_gap',
        reason: 'No snapshot test infrastructure detected'
      };
      appendJsonl(findingsFile, entry);

      // Track red signal
      trackRedSignal('ui_snapshot_gap', { file: filePath, platform });

      process.stderr.write(
        `[ui-snapshot-compare] ui_snapshot_gap: ${filePath} (${platform}) — no snapshot infra detected\n`
      );
    }

    process.exit(0);
  }

  main().catch(() => process.exit(0));
} catch (e) {
  try {
    process.stderr.write(`[ui-snapshot-compare] CRASH (fail-open): ${e.message}\n`);
  } catch { /* ignore */ }
  process.exit(0);
}
