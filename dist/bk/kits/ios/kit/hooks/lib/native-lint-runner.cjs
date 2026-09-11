/**
 * native-lint-runner.cjs — Shared library for native linting tool integration.
 *
 * Exports:
 *   detectTool(platform)         → { name, available, version, path } | { available: false, reason }
 *   runTool(platform, targetPath, opts) → { exitCode, findings, rawOutput, durationMs, truncated }
 *   parseSwiftlintJson(raw)      → normalized findings[]
 *   parseDetektXml(raw)          → normalized findings[]
 *   parseDartAnalyzeJson(raw)    → normalized findings[]
 *   withTimeout(promise, ms)     → promise with exit-code 124 semantics
 *
 * Mock env overrides (for tests):
 *   BK_NATIVE_LINT_MOCK_AVAILABLE=swiftlint|detekt|dart  — mark tool as available
 *   BK_NATIVE_LINT_MOCK_OUTPUT=<raw>                      — canned output for runTool
 *   BK_NATIVE_LINT_MOCK_EXIT=0|1|2                        — canned exit code for runTool
 *   BK_NATIVE_LINT_FORCE_UNAVAILABLE=1                    — force detection to fail
 *   BK_NATIVE_LINT_NO_CACHE=1                             — bypass 5-minute TTL cache
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const cp   = require('child_process');

const CACHE_FILE     = '.bk-metrics/native-tools-cache.json';
const CACHE_TTL_MS   = 5 * 60 * 1000; // 5 minutes
const DEFAULT_TIMEOUT_MS = 30000;
const MAX_OUTPUT_CHARS   = 500000; // ~500k chars before truncation

// ─── withTimeout helper ────────────────────────────────────────────────────

/**
 * Wrap a promise with a hard timeout.
 * On timeout, rejects with { timedOut: true, exitCode: 124 }.
 *
 * @param {Promise} promise
 * @param {number}  ms        — milliseconds
 * @param {Function} [onTimeout] — optional callback when timeout fires (e.g. kill child)
 * @returns {Promise}
 */
function withTimeout(promise, ms, onTimeout) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (onTimeout) {
        try { onTimeout(); } catch { /* ignore */ }
      }
      reject(Object.assign(new Error(`Timed out after ${ms}ms`), { timedOut: true, exitCode: 124 }));
    }, ms || DEFAULT_TIMEOUT_MS);

    promise.then(
      (result) => { clearTimeout(timer); resolve(result); },
      (err)    => { clearTimeout(timer); reject(err); }
    );
  });
}

// ─── Cache helpers ─────────────────────────────────────────────────────────

/**
 * Get the absolute path to the cache file.
 */
function getCachePath() {
  const root = process.env.BK_PROJECT_ROOT || process.cwd();
  return path.join(root, CACHE_FILE);
}

/**
 * Read the detection cache. Returns {} on miss/error.
 */
function readCache() {
  if (process.env.BK_NATIVE_LINT_NO_CACHE === '1') return {};
  try {
    const cachePath = getCachePath();
    if (!fs.existsSync(cachePath)) return {};
    const raw = fs.readFileSync(cachePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Write detection result to cache.
 */
function writeCache(platform, result) {
  if (process.env.BK_NATIVE_LINT_NO_CACHE === '1') return;
  try {
    const cachePath = getCachePath();
    const dir = path.dirname(cachePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const cache = readCache();
    cache[platform] = { result, ts: Date.now() };
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf8');
  } catch { /* fail-open */ }
}

/**
 * Check if cached entry for platform is still fresh (within TTL).
 */
function getCached(platform) {
  const cache = readCache();
  const entry = cache[platform];
  if (!entry) return null;
  const ttl = CACHE_TTL_MS;
  if (Date.now() - entry.ts > ttl) return null;
  return entry.result;
}

// ─── detectTool ────────────────────────────────────────────────────────────

/**
 * Detect whether native lint tool is available for a given platform.
 *
 * @param {'ios'|'android'|'flutter'} platform
 * @returns {{ name: string, available: boolean, version?: string, path?: string, reason?: string }}
 */
function detectTool(platform) {
  // Force unavailable (for fallback tests)
  if (process.env.BK_NATIVE_LINT_FORCE_UNAVAILABLE === '1') {
    return { available: false, reason: 'BK_NATIVE_LINT_FORCE_UNAVAILABLE=1' };
  }

  // Mock available (for detection tests)
  const mockAvail = process.env.BK_NATIVE_LINT_MOCK_AVAILABLE || '';
  if (mockAvail) {
    const tools = { ios: 'swiftlint', android: 'detekt', flutter: 'dart' };
    const toolName = tools[platform] || '';
    if (mockAvail === toolName || mockAvail === platform) {
      return { name: toolName, available: true, version: '0.0.0-mock', path: `/usr/local/bin/${toolName}` };
    }
    return { available: false, reason: `mock: tool not in BK_NATIVE_LINT_MOCK_AVAILABLE (${mockAvail})` };
  }

  // Check cache
  const cached = getCached(platform);
  if (cached !== null) return cached;

  let result;
  switch (platform) {
    case 'ios':    result = detectSwiftlint();   break;
    case 'android': result = detectDetekt();     break;
    case 'flutter': result = detectDart();       break;
    default:
      result = { available: false, reason: `Unknown platform: ${platform}` };
  }

  writeCache(platform, result);
  return result;
}

function detectSwiftlint() {
  try {
    // Use which to find the binary
    const whichOut = cp.execFileSync('which', ['swiftlint'], { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }).trim();
    if (!whichOut) return { available: false, reason: 'swiftlint not found in PATH' };

    // Get version
    const version = cp.execFileSync('swiftlint', ['--version'], { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }).trim();
    return { name: 'swiftlint', available: true, version, path: whichOut };
  } catch {
    return { available: false, reason: 'swiftlint not found in PATH' };
  }
}

function detectDetekt() {
  try {
    // Check for local gradlew with detekt task. We look for a gradlew in cwd or project root.
    const root = process.env.BK_PROJECT_ROOT || process.cwd();
    const gradlew = path.join(root, 'gradlew');
    if (!fs.existsSync(gradlew)) {
      return { available: false, reason: 'gradlew not found — detekt unavailable' };
    }
    // Check if detekt task exists (tasks --all output)
    // This is expensive so we skip it here and rely on the TTL cache.
    return { name: 'detekt', available: true, version: 'via gradlew', path: gradlew };
  } catch {
    return { available: false, reason: 'detekt detection failed' };
  }
}

function detectDart() {
  try {
    const whichOut = cp.execFileSync('which', ['dart'], { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }).trim();
    if (!whichOut) return { available: false, reason: 'dart not found in PATH' };

    const version = cp.execFileSync('dart', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).trim();
    return { name: 'dart', available: true, version: version || 'unknown', path: whichOut };
  } catch {
    return { available: false, reason: 'dart not found in PATH' };
  }
}

// ─── runTool ───────────────────────────────────────────────────────────────

/**
 * Run the native lint tool for a given platform on a target file/dir.
 *
 * @param {'ios'|'android'|'flutter'} platform
 * @param {string} targetPath
 * @param {{ timeoutMs?: number, policy?: object }} [opts]
 * @returns {Promise<{ exitCode: number, findings: object[], rawOutput: string, durationMs: number, truncated: boolean }>}
 */
async function runTool(platform, targetPath, opts = {}) {
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;

  // Mock mode: return canned output
  const mockOutput = process.env.BK_NATIVE_LINT_MOCK_OUTPUT;
  const mockExit   = process.env.BK_NATIVE_LINT_MOCK_EXIT;
  if (mockOutput !== undefined || mockExit !== undefined) {
    const rawOutput = mockOutput || '';
    const exitCode  = parseInt(mockExit || '0', 10);
    let findings    = parseOutput(platform, rawOutput);
    // P1-6: Even in mock mode, fall back to XML report file for android (detekt)
    // when stdout produces no findings — mirrors real-runtime behavior.
    if (platform === 'android' && findings.length === 0) {
      const xmlReport = readDetektXmlReport();
      if (xmlReport) findings = parseOutput('android', xmlReport);
    }
    return { exitCode, findings, rawOutput, durationMs: 0, truncated: false };
  }

  const start = Date.now();

  let child;
  let rawOutput = '';
  let exitCode  = 0;

  const runPromise = new Promise((resolve) => {
    const { args, cmd } = buildCommand(platform, targetPath, opts);
    try {
      child = cp.execFile(cmd, args, { maxBuffer: MAX_OUTPUT_CHARS }, (err, stdout, stderr) => {
        rawOutput = (stdout || '') + (stderr || '');
        exitCode = err ? (err.code || 1) : 0;
        resolve();
      });
    } catch (e) {
      rawOutput = e.message;
      exitCode  = 1;
      resolve();
    }
  });

  try {
    await withTimeout(runPromise, timeoutMs, () => {
      if (child) { try { child.kill('SIGTERM'); } catch { /* ignore */ } }
    });
  } catch (e) {
    if (e.timedOut) {
      return { exitCode: 124, findings: [], rawOutput: `Timed out after ${timeoutMs}ms`, durationMs: Date.now() - start, truncated: false };
    }
    return { exitCode: 1, findings: [], rawOutput: e.message, durationMs: Date.now() - start, truncated: false };
  }

  const truncated = rawOutput.length >= MAX_OUTPUT_CHARS;
  const durationMs = Date.now() - start;
  let findings = parseOutput(platform, rawOutput);

  // P1-6: Detekt via gradlew writes XML to build/reports/detekt/detekt.xml,
  // not stdout — stdout is gradle build progress. If stdout parse yielded zero,
  // fall back to reading the report file directly.
  if (platform === 'android' && findings.length === 0) {
    const xmlReport = readDetektXmlReport();
    if (xmlReport) {
      findings = parseOutput('android', xmlReport);
    }
  }

  return { exitCode, findings, rawOutput, durationMs, truncated };
}

/**
 * P1-6 helper: read detekt XML report from common gradle output paths.
 * Mock-friendly via BK_NATIVE_LINT_MOCK_DETEKT_XML_PATH env var.
 * @returns {string|null} XML content or null if not found
 */
function readDetektXmlReport() {
  // Mock override (for tests)
  const mockPath = process.env.BK_NATIVE_LINT_MOCK_DETEKT_XML_PATH;
  if (mockPath && fs.existsSync(mockPath)) {
    try { return fs.readFileSync(mockPath, 'utf8'); } catch { return null; }
  }
  const root = process.env.BK_PROJECT_ROOT || process.cwd();
  // Common detekt output paths (root project, app module, multi-module convention)
  const candidates = [
    path.join(root, 'build', 'reports', 'detekt', 'detekt.xml'),
    path.join(root, 'app', 'build', 'reports', 'detekt', 'detekt.xml'),
    path.join(root, 'build', 'reports', 'detekt', 'main.xml')
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
    } catch { /* continue */ }
  }
  return null;
}

/**
 * Build the command + args for the given platform.
 */
function buildCommand(platform, targetPath, opts = {}) {
  const policy = opts.policy || {};
  switch (platform) {
    case 'ios': {
      const configPath = (policy.ios && policy.ios.config_path) || '.swiftlint.yml';
      const args = ['lint', '--quiet', '--reporter', 'json'];
      // Add config if it exists
      const root = process.env.BK_PROJECT_ROOT || process.cwd();
      if (fs.existsSync(path.join(root, configPath))) {
        args.push('--config', configPath);
      }
      args.push(targetPath);
      return { cmd: 'swiftlint', args };
    }
    case 'android': {
      const root = process.env.BK_PROJECT_ROOT || process.cwd();
      const gradlew = path.join(root, 'gradlew');
      return { cmd: gradlew, args: ['detekt', '--format', 'xml', '--input', targetPath] };
    }
    case 'flutter': {
      return { cmd: 'dart', args: ['analyze', '--format=json', targetPath] };
    }
    default:
      throw new Error(`Unknown platform: ${platform}`);
  }
}

/**
 * Parse raw tool output to normalized findings for a platform.
 */
function parseOutput(platform, raw) {
  try {
    switch (platform) {
      case 'ios':      return parseSwiftlintJson(raw);
      case 'android':  return parseDetektXml(raw);
      case 'flutter':  return parseDartAnalyzeJson(raw);
      default:         return [];
    }
  } catch {
    return [];
  }
}

// ─── Parser: SwiftLint JSON ────────────────────────────────────────────────

/**
 * Parse SwiftLint JSON output (--reporter json) to normalized findings.
 * SwiftLint JSON: array of { file, line, character, severity, reason, rule_id }
 *
 * @param {string} raw
 * @returns {{ file: string, line: number, severity: string, rule: string, message: string }[]}
 */
function parseSwiftlintJson(raw) {
  if (!raw || !raw.trim()) return [];
  let data;
  try {
    // SwiftLint may emit non-JSON warnings before the JSON array; find the first '['
    const start = raw.indexOf('[');
    if (start === -1) return [];
    data = JSON.parse(raw.slice(start));
  } catch {
    return [];
  }

  if (!Array.isArray(data)) return [];

  return data.map(item => ({
    file:     item.file     || item.path || '',
    line:     typeof item.line === 'number' ? item.line : parseInt(item.line || '0', 10),
    severity: normalizeSeverity(item.severity),
    rule:     item.rule_id  || item.ruleIdentifier || 'unknown',
    message:  item.reason   || item.message || ''
  })).filter(f => f.file);
}

// ─── Parser: detekt XML (Checkstyle format) ────────────────────────────────

/**
 * Parse detekt XML (Checkstyle format) to normalized findings.
 * Format: <checkstyle><file name="..."><error line="..." severity="..." message="..." source="..."/></file></checkstyle>
 *
 * @param {string} raw
 * @returns {{ file: string, line: number, severity: string, rule: string, message: string }[]}
 */
function parseDetektXml(raw) {
  if (!raw || !raw.trim()) return [];

  const findings = [];

  // Simple regex-based XML parser (avoid dependency on xml2js)
  // Match each <file name="..."> block
  const filePattern = /<file\s+name="([^"]*)"[^>]*>([\s\S]*?)<\/file>/g;
  let fileMatch;
  while ((fileMatch = filePattern.exec(raw)) !== null) {
    const filePath = fileMatch[1];
    const fileContent = fileMatch[2];

    // Match each <error> element
    const errorPattern = /<error\s([^>]*?)\/>/g;
    let errorMatch;
    while ((errorMatch = errorPattern.exec(fileContent)) !== null) {
      const attrs = errorMatch[1];
      const line     = parseInt(extractAttr(attrs, 'line') || '0', 10);
      const severity = normalizeSeverity(extractAttr(attrs, 'severity') || 'warning');
      const message  = decodeXmlEntities(extractAttr(attrs, 'message') || '');
      const source   = extractAttr(attrs, 'source') || 'unknown';
      // source is typically "io.gitlab.arturbosch.detekt.rules.XxxRule"
      const rule = source.split('.').pop() || source;

      findings.push({ file: filePath, line, severity, rule, message });
    }
  }

  return findings;
}

function extractAttr(attrStr, name) {
  const match = attrStr.match(new RegExp(`${name}="([^"]*)"`));
  return match ? match[1] : null;
}

function decodeXmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

// ─── Parser: dart analyze JSON ─────────────────────────────────────────────

/**
 * Parse `dart analyze --format=json` output to normalized findings.
 * Dart analyze JSON: { version: 1, diagnostics: [{ code, severity, message, location: { file, range: { start: { line } } }, url }] }
 *
 * @param {string} raw
 * @returns {{ file: string, line: number, severity: string, rule: string, message: string }[]}
 */
function parseDartAnalyzeJson(raw) {
  if (!raw || !raw.trim()) return [];

  let data;
  try {
    // dart analyze may emit non-JSON lines first; find the first '{'
    const start = raw.indexOf('{');
    if (start === -1) return [];
    data = JSON.parse(raw.slice(start));
  } catch {
    return [];
  }

  const diagnostics = data.diagnostics || [];
  if (!Array.isArray(diagnostics)) return [];

  return diagnostics.map(d => {
    const location = d.location || {};
    const range    = location.range || {};
    const startPos = range.start || {};
    const line     = typeof startPos.line === 'number' ? startPos.line + 1 : parseInt(startPos.line || '1', 10);

    return {
      file:     location.file || '',
      line,
      severity: normalizeSeverity(d.severity || 'warning'),
      rule:     d.code || 'unknown',
      message:  d.message || ''
    };
  }).filter(f => f.file);
}

// ─── Severity normalizer ───────────────────────────────────────────────────

/**
 * Normalize severity strings from various tools to: 'error' | 'warning' | 'convention' | 'info'
 */
function normalizeSeverity(sev) {
  if (!sev) return 'warning';
  const s = String(sev).toLowerCase();
  if (s === 'error')      return 'error';
  if (s === 'warning')    return 'warning';
  if (s === 'convention') return 'convention';
  if (s === 'info' || s === 'information' || s === 'hint') return 'info';
  if (s === 'refactoring' || s === 'style') return 'convention';
  return 'warning';
}

// ─── Exports ───────────────────────────────────────────────────────────────

module.exports = {
  detectTool,
  runTool,
  parseSwiftlintJson,
  parseDetektXml,
  parseDartAnalyzeJson,
  withTimeout,
  normalizeSeverity,
  // Internal exports for tests
  _getCachePath:  getCachePath,
  _readCache:     readCache,
  _writeCache:    writeCache,
  _getCached:     getCached
};
