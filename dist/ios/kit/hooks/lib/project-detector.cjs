/**
 * project-detector.cjs - Project and mobile platform detection
 *
 * Adds: detectMobilePlatform() for ios|android|flutter|unknown
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

/**
 * Detect mobile platform from project structure
 *
 * Priority order:
 *   1. flutter  — pubspec.yaml exists
 *   2. ios      — *.xcworkspace or *.xcodeproj found, no android/build.gradle
 *   3. android  — android/build.gradle or build.gradle with android plugin
 *   4. unknown  — none of the above
 *
 * @returns {'ios'|'android'|'flutter'|'unknown'}
 */
function detectMobilePlatform() {
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

  return 'unknown';
}

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
  detectMobilePlatform,
  getGitBranch,
  getGitRoot,
  getGitRemoteUrl
};
