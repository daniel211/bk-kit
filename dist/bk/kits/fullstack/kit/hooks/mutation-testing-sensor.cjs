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
    'package.json', 'Package.swift', 'build.gradle', 'build.gradle.kts', 'pubspec.yaml',
    'pyproject.toml', 'setup.cfg'
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
  // Flutter mutation packages
  const FLUTTER_MUTATION_PACKAGES = ['mutation_test'];
  // Python: cosmic-ray reads a TOML session config (any name; these are the conventional ones)
  const PYTHON_CONFIG_FILES = ['cosmic-ray.toml', '.cosmic-ray.toml', 'cr.toml'];
  // Python: mutmut / cosmic-ray configured in pyproject.toml (section or dependency) or setup.cfg
  const PYTHON_PYPROJECT_RE = /^\s*\[tool\.(mutmut|cosmic-ray)\]|["'\s](mutmut|cosmic-ray)\s*(?:[<>=~!]|["'])/m;
  const PYTHON_SETUP_CFG_RE = /^\s*\[(mutmut|cosmic-ray)\]/m;
  // Web: Stryker config files (stryker.conf.* and stryker.config.*, any JS/TS/JSON flavour)
  const WEB_STRYKER_RE = /^stryker\.conf(?:ig)?\.(?:[cm]?[jt]s|json)$/;

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
   * Scan for Android mutation testing configs. Pitest is the JVM tool; Stryker configs (JS/TS)
   * used to count here too and made every Stryker web project read as "android ready".
   */
  function detectAndroidMutation(projectRoot) {
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

  /** Read a root file, '' when absent or unreadable. */
  function readRoot(projectRoot, name) {
    try { return fs.readFileSync(path.join(projectRoot, name), 'utf8'); } catch { return ''; }
  }

  /**
   * Scan for Python mutation testing configs: mutmut or cosmic-ray.
   */
  function detectPythonMutation(projectRoot) {
    for (const f of PYTHON_CONFIG_FILES) {
      if (fs.existsSync(path.join(projectRoot, f))) return { found: true, tool: 'cosmic-ray', file: f };
    }
    const pyproject = PYTHON_PYPROJECT_RE.exec(readRoot(projectRoot, 'pyproject.toml'));
    if (pyproject) return { found: true, tool: pyproject[1] || pyproject[2], file: 'pyproject.toml' };
    const setupCfg = PYTHON_SETUP_CFG_RE.exec(readRoot(projectRoot, 'setup.cfg'));
    if (setupCfg) return { found: true, tool: setupCfg[1], file: 'setup.cfg' };
    return { found: false };
  }

  /**
   * Scan for web (JS/TS) mutation testing configs: Stryker.
   */
  function detectWebMutation(projectRoot) {
    let entries = [];
    try { entries = fs.readdirSync(projectRoot); } catch { /* unreadable root */ }
    const conf = entries.find((e) => WEB_STRYKER_RE.test(e));
    if (conf) return { found: true, tool: 'Stryker', file: conf };
    if (/"@stryker-mutator\//.test(readRoot(projectRoot, 'package.json'))) {
      return { found: true, tool: 'Stryker', file: 'package.json' };
    }
    return { found: false };
  }

  /**
   * Scan the project root, then — in a composite kit (fullstack: backend/ + frontend/) — the root
   * of every component of that platform, so a mutmut config in backend/pyproject.toml counts.
   * `file` is reported relative to the project root. Fail-open: no components → root only.
   */
  function detectInComponents(detect, platform, projectRoot) {
    const atRoot = detect(projectRoot);
    if (atRoot.found) return atRoot;
    try {
      const { readComponents, componentCwd } = require('./lib/component-resolver.cjs');
      for (const c of readComponents(projectRoot) || []) {
        if (c.platform !== platform || c.root === '.') continue;
        const hit = detect(componentCwd(c, projectRoot));
        if (hit.found) return { ...hit, file: path.posix.join(c.root, hit.file) };
      }
    } catch { /* fail-open */ }
    return atRoot;
  }

  /**
   * Run a full mutation readiness scan and write results.
   */
  function runScan(projectRoot) {
    const ios     = detectIOSMutation(projectRoot);
    const android = detectAndroidMutation(projectRoot);
    const flutter = detectFlutterMutation(projectRoot);
    const python  = detectInComponents(detectPythonMutation, 'python', projectRoot);
    const web     = detectInComponents(detectWebMutation, 'web', projectRoot);

    const readiness = {
      timestamp: new Date().toISOString(),
      ios: ios.found
      ? { ready: true, tool: ios.tool, config: ios.file }
      : { ready: false, hint: 'Add Muter.conf.yml for iOS mutation testing with Muter' },
      android: android.found
      ? { ready: true, tool: android.tool, config: android.file }
      : { ready: false, hint: 'Apply the pitest Gradle plugin (info.solidsoft.pitest) for Android mutation testing' },
      flutter: flutter.found
      ? { ready: true, tool: flutter.tool, config: flutter.file }
      : { ready: false, hint: 'Add mutation_test package to pubspec.yaml for Flutter mutation testing' },
      python: python.found
      ? { ready: true, tool: python.tool, config: python.file }
      : { ready: false, hint: 'Add [tool.mutmut] to pyproject.toml (or a cosmic-ray.toml) for Python mutation testing' },
      web: web.found
      ? { ready: true, tool: web.tool, config: web.file }
      : { ready: false, hint: 'Add stryker.config.json / stryker.conf.js (@stryker-mutator/core) for web mutation testing' }
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
