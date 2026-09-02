#!/usr/bin/env node
// mutation-testing-sensor.cjs - Config detector + budget hint hook.
// Scans for mutation-testing tool configs on manifest file changes.
// NOT a continuous mutation tester — detector only.
// Observer-only: never blocks. Exit 0 always.

'use strict';

try {
  const fs = require('fs');
  const path = require('path');

  const { loadHarnessPolicy, resolveMetricPath } = require('./lib/harness-policy-loader.cjs');
  const { isHookEnabled } = require('./lib/bk-config-utils.cjs');
  const { resolveProjectRoot } = require('./lib/resolve-project-root.cjs');

  // Check hook enabled
  if (!isHookEnabled('mutation-testing-sensor')) process.exit(0);

  const policy = loadHarnessPolicy();
  const cfg = policy.mutation_testing || {};
  if (!cfg.enabled) process.exit(0);

  // Manifest files that trigger re-scan
  const MANIFEST_FILES = [
    'package.json', 'Package.swift', 'build.gradle', 'build.gradle.kts', 'pubspec.yaml'
  ];

  /**
   * Check if a file path is a manifest file.
   */
  function isManifestFile(filePath) {
    const base = path.basename(filePath);
    return MANIFEST_FILES.some(m => base === m);
  }

  // iOS mutation config files
  const IOS_CONFIG_FILES = ['Muter.conf.yml', '.muter-config.yml'];
  // Android mutation config files
  const ANDROID_CONFIG_FILES = ['stryker.conf.js', 'stryker.conf.ts', 'stryker.config.js'];
  // Flutter mutation packages
  const FLUTTER_MUTATION_PACKAGES = ['mutation_test'];

  /**
   * Scan for iOS mutation testing configs.
   */
  function detectIOSMutation(projectRoot) {
    for (const f of IOS_CONFIG_FILES) {
      if (fs.existsSync(path.join(projectRoot, f))) return { found: true, tool: 'Muter', file: f };
    }
    return { found: false };
  }

  /**
   * Scan for Android mutation testing configs.
   */
  function detectAndroidMutation(projectRoot) {
    for (const f of ANDROID_CONFIG_FILES) {
      if (fs.existsSync(path.join(projectRoot, f))) return { found: true, tool: 'Stryker/Pitest', file: f };
    }
    // Check Gradle for pitest plugin
    for (const gfile of ['build.gradle', 'build.gradle.kts', path.join('app', 'build.gradle')]) {
      const fullPath = path.join(projectRoot, gfile);
      if (fs.existsSync(fullPath)) {
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          if (/pitest|info\.solidsoft/i.test(content)) {
            return { found: true, tool: 'Pitest', file: gfile };
          }
        } catch { /* skip */ }
      }
    }
    return { found: false };
  }

  /**
   * Scan for Flutter mutation testing configs.
   */
  function detectFlutterMutation(projectRoot) {
    const pubspec = path.join(projectRoot, 'pubspec.yaml');
    if (fs.existsSync(pubspec)) {
      try {
        const content = fs.readFileSync(pubspec, 'utf8');
        for (const pkg of FLUTTER_MUTATION_PACKAGES) {
          if (content.includes(pkg)) {
            return { found: true, tool: pkg, file: 'pubspec.yaml' };
          }
        }
      } catch { /* skip */ }
    }
    return { found: false };
  }

  /**
   * Run a full mutation readiness scan and write results.
   */
  function runScan(projectRoot) {
    const ios     = detectIOSMutation(projectRoot);
    const android = detectAndroidMutation(projectRoot);
    const flutter = detectFlutterMutation(projectRoot);

    const readiness = {
      timestamp: new Date().toISOString(),
      ios: ios.found
      ? { ready: true, tool: ios.tool, config: ios.file }
      : { ready: false, hint: 'Add Muter.conf.yml for iOS mutation testing with Muter' },
      android: android.found
      ? { ready: true, tool: android.tool, config: android.file }
      : { ready: false, hint: 'Add stryker.conf.js or apply pitest Gradle plugin for Android mutation testing' },
      flutter: flutter.found
      ? { ready: true, tool: flutter.tool, config: flutter.file }
      : { ready: false, hint: 'Add mutation_test package to pubspec.yaml for Flutter mutation testing' }
    };

    const outputFile = resolveMetricPath('.bk-metrics/mutation-readiness.json', projectRoot);
    try {
      const dir = path.dirname(outputFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(outputFile, JSON.stringify(readiness, null, 2));
    } catch { /* fail-open */ }

    return readiness;
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

    const scanOnManifestChange = cfg.scan_on_manifest_change !== false;

    // Determine trigger:
    // 1. SessionEnd / manual (tool_name is undefined or 'SessionEnd')
    // 2. Manifest file changed
    const toolName = input.tool_name || '';
    const toolInput = input.tool_input || {};
    const filePath = toolInput.file_path || toolInput.path || '';

    let shouldScan = false;

    if (!toolName || toolName === 'SessionEnd') {
      shouldScan = true;
    } else if (scanOnManifestChange && filePath && isManifestFile(filePath)) {
      shouldScan = true;
    }

    if (!shouldScan) process.exit(0);

    const readiness = runScan(projectRoot);

    // Log any missing configs to stderr as hints
    const missing = [];
    for (const [platform, result] of Object.entries(readiness)) {
      if (platform === 'timestamp') continue;
      if (!result.ready) missing.push(platform);
    }

    if (missing.length > 0) {
      process.stderr.write(
        `[mutation-testing-sensor] No mutation testing config detected for: ${missing.join(', ')}. ` +
        `See .bk-metrics/mutation-readiness.json for hints.\n`
      );
    }

    process.exit(0);
  }

  main().catch(() => process.exit(0));
} catch (e) {
  try {
    process.stderr.write(`[mutation-testing-sensor] CRASH (fail-open): ${e.message}\n`);
  } catch { /* ignore */ }
  process.exit(0);
}
