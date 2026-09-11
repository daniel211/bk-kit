'use strict';
/**
 * native-lint.cjs — Dashboard panel for Native Linting sensor data.
 *
 * Reads .bk-metrics/native-lint-{ios,android,flutter}.jsonl and produces
 * a summary panel for the bk-health dashboard.
 *
 * Exports:
 *   buildNativeLintPanel(metricsDir) → NativeLintPanel
 *   renderNativeLintPanel(panel)     → string[]
 *
 * NativeLintPanel: {
 *   platforms: {
 *     ios:     PlatformData,
 *     android: PlatformData,
 *     flutter: PlatformData
 *   }
 * }
 *
 * PlatformData: {
 *   tool:       string,              // 'swiftlint' | 'detekt' | 'dart'
 *   available:  boolean,
 *   version:    string|null,
 *   findings24h: { error: number, warning: number, convention: number, info: number },
 *   totalFindings24h: number,
 *   cacheStatus: 'fresh' | 'expired' | 'no-cache',
 *   lastRun:    number|null          // timestamp ms
 * }
 */

const fs   = require('fs');
const path = require('path');

const WINDOW_24H = 24 * 60 * 60 * 1000;
const CACHE_TTL  = 5 * 60 * 1000; // 5 minutes

const PLATFORM_CONFIG = {
  ios:     { file: 'native-lint-ios.jsonl',     tool: 'swiftlint' },
  android: { file: 'native-lint-android.jsonl', tool: 'detekt'    },
  flutter: { file: 'native-lint-flutter.jsonl', tool: 'dart'      }
};

/**
 * Read last N lines from a JSONL file; silently skip malformed.
 */
function readJsonl(filePath, maxLines) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const lines = raw.split('\n').filter(l => l.trim().length > 0);
    const lastLines = lines.slice(-Math.max(maxLines, 100));
    const result = [];
    for (const line of lastLines) {
      try { result.push(JSON.parse(line)); } catch { /* skip */ }
    }
    return result;
  } catch { return []; }
}

/**
 * Read native-tools-cache.json to get tool detection results.
 * Returns {} on miss/error.
 */
function readToolCache(metricsDir) {
  try {
    const cachePath = path.join(metricsDir, 'native-tools-cache.json');
    if (!fs.existsSync(cachePath)) return {};
    return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  } catch { return {}; }
}

/**
 * Compute cache status for a platform.
 */
function cacheStatus(cacheEntry) {
  if (!cacheEntry) return 'no-cache';
  const age = Date.now() - (cacheEntry.ts || 0);
  return age < CACHE_TTL ? 'fresh' : 'expired';
}

/**
 * Build data for one platform.
 */
function buildPlatformData(platform, metricsDir, toolCache) {
  const cfg = PLATFORM_CONFIG[platform];
  const filePath = path.join(metricsDir, cfg.file);
  const entries = readJsonl(filePath, 500);

  // Filter to last 24h
  const cutoff = Date.now() - WINDOW_24H;
  const recent = entries.filter(e => e.ts && e.ts >= cutoff);

  // Count findings by severity
  const findings24h = { error: 0, warning: 0, convention: 0, info: 0 };
  for (const rec of recent) {
    for (const f of (rec.findings || [])) {
      const sev = f.severity || 'warning';
      if (sev in findings24h) findings24h[sev]++;
    }
  }
  const totalFindings24h = Object.values(findings24h).reduce((a, b) => a + b, 0);

  // Tool availability from cache
  const cacheEntry = toolCache[platform];
  const toolInfo   = cacheEntry && cacheEntry.result ? cacheEntry.result : null;
  const available  = toolInfo ? (toolInfo.available === true) : null; // null = unknown
  const version    = toolInfo && toolInfo.available ? (toolInfo.version || 'unknown') : null;

  // Last run
  const lastRun = entries.length > 0 ? entries[entries.length - 1].ts : null;

  return {
    tool:             cfg.tool,
    available,
    version,
    findings24h,
    totalFindings24h,
    cacheStatus:      cacheStatus(cacheEntry),
    lastRun
  };
}

/**
 * Build native lint panel data from metricsDir.
 *
 * @param {string} metricsDir — absolute path to .bk-metrics/ directory
 * @returns {{ platforms: { ios: object, android: object, flutter: object } }}
 */
function buildNativeLintPanel(metricsDir) {
  const toolCache = readToolCache(metricsDir);

  const platforms = {};
  for (const platform of ['ios', 'android', 'flutter']) {
    platforms[platform] = buildPlatformData(platform, metricsDir, toolCache);
  }

  return { platforms };
}

/**
 * Render the native lint panel as lines for dashboard boxLine() rendering.
 *
 * @param {{ platforms: object }} panel
 * @returns {string[]}
 */
function renderNativeLintPanel(panel) {
  if (!panel || !panel.platforms) return ['No native lint data'];

  const lines = [];

  for (const [platform, data] of Object.entries(panel.platforms)) {
    const toolName = (data.tool || platform).toUpperCase();
    const platLabel = platform.toUpperCase();

    // Availability indicator
    let availStr;
    if (data.available === true) {
      availStr = `✓ ${data.tool} ${data.version || ''}`.trim();
    } else if (data.available === false) {
      availStr = `✗ not installed`;
    } else {
      availStr = `? not yet detected`;
    }

    // Findings summary
    const f = data.findings24h;
    const findingsStr = data.totalFindings24h === 0
      ? 'no findings'
      : `E:${f.error} W:${f.warning} C:${f.convention}`;

    // Cache status
    const cacheStr = data.cacheStatus;

    lines.push(`${platLabel}: ${availStr} | ${findingsStr} (24h) | cache: ${cacheStr}`);
  }

  return lines;
}

module.exports = { buildNativeLintPanel, renderNativeLintPanel };
