/**
 * project-detector.cjs - Project and platform detection
 *
 * Adds: detectPlatform() for ios|android|flutter|fullstack|python|web|unknown
 *       hasFullstackMarkers(root) — python + web markers at the root or a first-level subdir
 *       detectSingleStack(root)   — python / web kit and its root ('.' or one first-level subdir)
 *       (detectMobilePlatform() is the historical name of the same function)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { getGitInfo } = require('./git-info-cache.cjs');
const { resolveProjectRoot } = require('./resolve-project-root.cjs');

/**
 * Safely execute a shell command with timeout
 * @param {string} cmd
 * @param {number} timeoutMs
 * @returns {string|null}
 */
function execSafe(cmd, timeoutMs = 3000) {
  try {
    return execSync(cmd, {
      encoding: 'utf8',
      timeout: timeoutMs,
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Detect project type from workspace indicators
 * @param {string} [override]
 * @returns {'monorepo'|'library'|'single-repo'}
 */
function detectProjectType(override) {
  if (override && override !== 'auto') return override;
  const root = resolveProjectRoot();

  if (fs.existsSync(path.join(root, 'pnpm-workspace.yaml')) || fs.existsSync(path.join(root, 'lerna.json'))) {
    return 'monorepo';
  }

  const pkgPath = path.join(root, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.workspaces) return 'monorepo';
      if (pkg.main || pkg.exports) return 'library';
    } catch { /* ignore */ }
  }

  return 'single-repo';
}

/**
 * Detect package manager from lock files
 * @param {string} [override]
 * @returns {'npm'|'pnpm'|'yarn'|'bun'|null}
 */
function detectPackageManager(override) {
  if (override && override !== 'auto') return override;
  const root = resolveProjectRoot();

  if (fs.existsSync(path.join(root, 'bun.lockb'))) return 'bun';
  if (fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(root, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(root, 'package-lock.json'))) return 'npm';

  return null;
}

/** python root markers — the same set kit-resolver.mjs (bk init) uses. */
const PYTHON_MARKERS = ['pyproject.toml', 'requirements.txt', 'manage.py', 'setup.py'];

/** Files that make a package.json root a TypeScript / bundled web app (kit-resolver.mjs). */
const WEB_CONFIG_RE = /^(?:tsconfig\.json|(?:next|vite)\.config\.[cm]?[jt]s)$/;

/**
 * First-level dirs never scanned for component markers: dependencies, venvs, and dirs that hold
 * tooling rather than a component (a `docs/requirements.txt` for mkdocs must not turn a web repo
 * into fullstack). Dot-dirs are skipped separately. MUST equal kit-resolver.mjs SKIPPED_SUBDIRS
 * (bk init) — the hooks cannot import that ESM module, so a test asserts the two lists match.
 */
const SKIPPED_SUBDIRS = new Set([
  'node_modules', '.venv', 'venv',
  'docs', 'doc', 'scripts', 'tools', 'examples', 'e2e', 'tests', 'test'
]);

/** python marker in a directory listing. */
function hasPythonMarker(entries) {
  return entries.some(e => PYTHON_MARKERS.includes(e));
}

/** web marker in a directory listing: package.json AND a TS / bundler config. */
function hasWebMarker(entries) {
  return entries.includes('package.json') && entries.some(e => WEB_CONFIG_RE.test(e));
}

/**
 * Python AND web markers, each at the root or in a first-level subdir (SKIPPED_SUBDIRS and
 * dot-dirs skipped) — the `fullstack` composite kit (`backend/` + `frontend/`, or both at the
 * root). Same rule as kit-resolver.mjs, so `bk init` and the hooks agree. One readdir of the
 * root plus one per subdir; never deeper. Fail-open: unreadable → false.
 * @param {string} root
 * @returns {boolean}
 */
function hasFullstackMarkers(root) {
  let top;
  try { top = fs.readdirSync(root, { withFileTypes: true }); } catch { return false; }
  const listings = [top.map(e => e.name)];
  for (const e of top) {
    if (!e.isDirectory() || e.name.startsWith('.') || SKIPPED_SUBDIRS.has(e.name)) continue;
    try { listings.push(fs.readdirSync(path.join(root, e.name))); } catch { /* skip unreadable */ }
  }
  return listings.some(hasPythonMarker) && listings.some(hasWebMarker);
}

/**
 * Conventional component dir names, most likely first. MUST equal CONVENTIONAL_DIRS in
 * cli/user-cli/lib/component-detector.mjs (bk init) — a test asserts the two match.
 */
const CONVENTIONAL_DIRS = {
  python: ['backend', 'api', 'server'],
  web: ['frontend', 'web', 'client', 'app']
};

const MARKER_TESTS = { python: hasPythonMarker, web: hasWebMarker };

/**
 * The single-stack kit (python, then web) and its root — run AFTER the fullstack check, so at
 * most one of the two stacks has markers anywhere. Root markers win: `.` when the root has them.
 * Otherwise the first-level subdirs (SKIPPED_SUBDIRS and dot-dirs skipped) that carry them:
 * a conventional name first (python: backend/api/server; web: frontend/web/client/app), else the
 * first alphabetically — the component-detector.mjs rule, so `bk init` writes the same `root`.
 * Fail-open: unreadable → null.
 * @param {string} root
 * @returns {{platform: 'python'|'web', root: string}|null}
 */
function detectSingleStack(root) {
  let top;
  try { top = fs.readdirSync(root, { withFileTypes: true }); } catch { return null; }
  const names = top.map(e => e.name);
  const subdirs = top
    .filter(e => e.isDirectory() && !e.name.startsWith('.') && !SKIPPED_SUBDIRS.has(e.name))
    .map(e => e.name)
    .sort();
  const listings = new Map();
  for (const name of subdirs) {
    try { listings.set(name, fs.readdirSync(path.join(root, name))); } catch { /* skip unreadable */ }
  }
  for (const platform of ['python', 'web']) {
    if (MARKER_TESTS[platform](names)) return { platform, root: '.' };
  }
  for (const platform of ['python', 'web']) {
    const hits = subdirs.filter(d => listings.has(d) && MARKER_TESTS[platform](listings.get(d)));
    if (hits.length === 0) continue;
    const conventional = CONVENTIONAL_DIRS[platform].find(d => hits.includes(d));
    return { platform, root: conventional || hits[0] };
  }
  return null;
}

/**
 * Detect the project's platform from its root
 *
 * Priority order (mobile first, then the kit-resolver.mjs order — a mobile repo often carries a
 * requirements.txt or a package.json for its tooling; a backend or web root rarely carries an
 * .xcodeproj or a pubspec.yaml):
 *   1. flutter  — pubspec.yaml exists
 *   2. ios      — *.xcworkspace or *.xcodeproj found, no android/build.gradle
 *   3. android  — android/build.gradle or build.gradle with android plugin
 *   4. fullstack — python AND web markers, each at the root or in a first-level subdir
 *   5. python   — pyproject.toml | requirements.txt | manage.py | setup.py at the root
 *   6. web      — package.json AND (tsconfig.json | next.config.* | vite.config.*) at the root
 *   7. python, then web — the same markers in a first-level subdir only (`backend/` with uv)
 *   8. unknown  — none of the above
 *
 * @returns {'ios'|'android'|'flutter'|'fullstack'|'python'|'web'|'unknown'}
 */
function detectPlatform() {
  const cwd = resolveProjectRoot();

  // Flutter: pubspec.yaml is the definitive indicator
  if (fs.existsSync(path.join(cwd, 'pubspec.yaml'))) {
    return 'flutter';
  }

  // iOS: check for Xcode workspace or project
  const hasXcworkspace = _findGlob(cwd, '.xcworkspace');
  const hasXcodeproj = _findGlob(cwd, '.xcodeproj');
  // Android: check for build.gradle with android configuration
  const hasAndroidBuildGradle = (
    fs.existsSync(path.join(cwd, 'android', 'build.gradle')) ||
    fs.existsSync(path.join(cwd, 'build.gradle'))
  );

  if ((hasXcworkspace || hasXcodeproj) && !hasAndroidBuildGradle) {
    return 'ios';
  }

  if (hasAndroidBuildGradle && !(hasXcworkspace || hasXcodeproj)) {
    return 'android';
  }

  // Monorepo: both platforms present — default to ios (let config override)
  if ((hasXcworkspace || hasXcodeproj) && hasAndroidBuildGradle) {
    return 'ios';
  }

  if (hasFullstackMarkers(cwd)) return 'fullstack';

  const single = detectSingleStack(cwd);
  return single ? single.platform : 'unknown';
}

/**
 * Historical name: callers (session-init, statusline) use it as "the platform", so it now also
 * answers fullstack / python / web.
 * @returns {'ios'|'android'|'flutter'|'fullstack'|'python'|'web'|'unknown'}
 */
const detectMobilePlatform = detectPlatform;

/**
 * Find any file with a given suffix in cwd's top-level or ios/ subdirectory
 * @param {string} dir
 * @param {string} suffix
 * @returns {boolean}
 */
function _findGlob(dir, suffix) {
  try {
    const entries = fs.readdirSync(dir);
    if (entries.some(e => e.endsWith(suffix))) return true;

    // Also check ios/ subdirectory (common flutter/RN layout)
    const iosDir = path.join(dir, 'ios');
    if (fs.existsSync(iosDir)) {
      const iosEntries = fs.readdirSync(iosDir);
      if (iosEntries.some(e => e.endsWith(suffix))) return true;
    }
  } catch { /* ignore */ }
  return false;
}

/**
 * Get current git branch (uses cached git info when available)
 * @returns {string|null}
 */
function getGitBranch() {
  try {
    const info = getGitInfo();
    if (info && info.branch) return info.branch;
  } catch { /* fallback below */ }
  return execSafe('git branch --show-current');
}

/**
 * Get git repository root
 * @returns {string|null}
 */
function getGitRoot() {
  return execSafe('git rev-parse --show-toplevel');
}

/**
 * Get git remote URL
 * @returns {string|null}
 */
function getGitRemoteUrl() {
  return execSafe('git config --get remote.origin.url');
}

module.exports = {
  execSafe,
  detectProjectType,
  detectPackageManager,
  detectPlatform,
  detectMobilePlatform,
  hasFullstackMarkers,
  detectSingleStack,
  SKIPPED_SUBDIRS,
  CONVENTIONAL_DIRS,
  getGitBranch,
  getGitRoot,
  getGitRemoteUrl
};
