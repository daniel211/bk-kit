/**
 * native-lint-runner.cjs — Shared library for native linting tool integration.
 *
 * Exports:
 *   detectTool(platform, {root}) → { name, available, version, path, runner? } | { available: false, reason }
 *                                  (android: lib/detekt-config-detector.cjs — gradlew alone is not detekt)
 *   runTool(platform, target, opts) → { exitCode, findings, rawOutput, durationMs, truncated }
 *                                  target is one path or an array of paths (one batched run)
 *   buildCommand(platform, target, opts) → { cmd, args }
 *   parseSwiftlintJson(raw)      → normalized findings[]
 *   parseDetektXml(raw)          → normalized findings[]
 *   parseDartAnalyzeJson(raw)    → normalized findings[]
 *   withTimeout(promise, ms)     → promise with exit-code 124 semantics
 *   GRADLE_BATCH_TIMEOUT_MS      — the floor a background (flush) caller gives a gradle detekt run
 *
 * Mock env overrides (for tests):
 *   BK_NATIVE_LINT_MOCK_AVAILABLE=swiftlint|detekt|dart  — mark tool as available
 *   BK_NATIVE_LINT_MOCK_OUTPUT=<raw>                      — canned output for runTool
 *   BK_NATIVE_LINT_MOCK_EXIT=0|1|2                        — canned exit code for runTool
 *   BK_NATIVE_LINT_FORCE_UNAVAILABLE=1                    — force detection to fail
 *   BK_NATIVE_LINT_NO_CACHE=1                             — bypass 5-minute TTL cache
 *   BK_LINT_MOCK_CMD_LOG=<path>                           — append the command that WOULD run,
 *                                                           one line per invocation
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const cp   = require('child_process');
const { resolveProjectRoot } = require('./resolve-project-root.cjs');
const { detectDetekt: detectDetektIn } = require('./detekt-config-detector.cjs');
const { MISSING_TOOL_RE } = require('./lint-batch-runner.cjs');
const { collectDetektReports, scopeFindings } = require('./detekt-gradle-reports.cjs');

/**
 * The project root every path in this module resolves against.
 *
 * Field review 2026-11-01: each site here read `process.env.BK_PROJECT_ROOT || process.cwd()`,
 * so a hook invoked with the session cwd'd below the root wrote
 * `<subdir>/.bk-metrics/native-tools-cache.json` and looked for `.swiftlint.yml` / `gradlew`
 * in a directory that has neither — tool detection then cached "not found" against the wrong
 * tree. resolveProjectRoot() still honours BK_PROJECT_ROOT first (so test overrides are
 * unchanged) and only falls back to process.cwd() after walking up for a project marker.
 */
function projectRoot() {
  return resolveProjectRoot();
}

const CACHE_FILE     = '.bk-metrics/native-tools-cache.json';
const CACHE_TTL_MS   = 5 * 60 * 1000; // 5 minutes
/**
 * Detection-cache schema. An entry without this exact `v` is ignored and re-detected.
 *
 * Field review 2026-11-25: entries written before 2 say android detekt is available "via gradlew"
 * for any tree with a gradlew — the very bug detection was fixed for. Honouring them until their
 * TTL ran out would keep a ktlint-only project's lint silent; bump this whenever a detector's
 * answer for the same tree changes.
 */
const CACHE_SCHEMA = 2;
const DEFAULT_TIMEOUT_MS = 30000;
/**
 * Floor on the timeout of a `./gradlew detekt` run from the background flush (opts.gradleTimeoutMs).
 * The flush's 60s per-command bound was sized for single-file tools; a Gradle run pays daemon
 * start + configuration of every module before detekt starts. Measured 2026-11-25 on a 2-module
 * toy project (Gradle 9.9.1, detekt 1.23.8, no Android plugin): 6-7s per run — a real Android
 * build's configuration phase is commonly tens of seconds on top. Never used inline:
 * a hook path that waits on Gradle is the 5s-budget bug hook-budget.cjs exists for.
 */
const GRADLE_BATCH_TIMEOUT_MS = parseInt(process.env.BK_NATIVE_LINT_GRADLE_TIMEOUT_MS || '150000', 10);
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
  const root = projectRoot();
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
    cache[platform] = { result, ts: Date.now(), v: CACHE_SCHEMA };
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf8');
  } catch { /* fail-open */ }
}

/**
 * Cache key: the platform, or `<platform>:<root relative to the project>` for a tool detected in a
 * component root below the project (mobile_native: android/gradlew) — the plain key stays what the
 * bk-health panel reads.
 */
function cacheKey(platform, root) {
  if (!root) return platform;
  const rel = path.relative(projectRoot(), root).split(path.sep).join('/');
  return rel && rel !== '.' ? `${platform}:${rel}` : platform;
}

/**
 * Check if cached entry for platform is still fresh (within TTL).
 */
function getCached(platform) {
  const cache = readCache();
  const entry = cache[platform];
  if (!entry) return null;
  // A pre-schema entry may carry the old any-gradlew-means-detekt answer — never trust it.
  if (entry.v !== CACHE_SCHEMA) return null;
  const ttl = CACHE_TTL_MS;
  if (Date.now() - entry.ts > ttl) return null;
  return entry.result;
}

// ─── detectTool ────────────────────────────────────────────────────────────

/**
 * Detect whether native lint tool is available for a given platform.
 *
 * @param {'ios'|'android'|'flutter'} platform
 * @param {{ root?: string }} [opts] — root: the component dir the tool runs in (default the
 *   project root); only android looks there (its gradlew)
 * @returns {{ name: string, available: boolean, version?: string, path?: string, reason?: string }}
 */
function detectTool(platform, opts = {}) {
  const root = opts && opts.root ? opts.root : undefined;
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
  const key = cacheKey(platform, root);
  const cached = getCached(key);
  if (cached !== null) return cached;

  let result;
  switch (platform) {
    case 'ios':    result = detectSwiftlint();   break;
    case 'android': result = detectDetekt(root); break;
    case 'flutter': result = detectDart();       break;
    default:
      result = { available: false, reason: `Unknown platform: ${platform}` };
  }

  writeCache(key, result);
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

/**
 * detekt in the component root (mobile_native: android/), else the project root. A gradlew alone
 * is not detekt: see lib/detekt-config-detector.cjs for the field evidence and what is checked.
 */
function detectDetekt(componentRoot) {
  return detectDetektIn(componentRoot || projectRoot());
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
 * Run the native lint tool for a given platform on one path or a batch of paths.
 *
 * A batch is ONE process, not one per file: the Stop-time flush exists to turn N
 * edits into a single analyze run.
 *
 * @param {'ios'|'android'|'flutter'} platform
 * @param {string|string[]} targetPath
 * @param {{ timeoutMs?: number, gradleTimeoutMs?: number, policy?: object, cwd?: string,
 *   tool?: object }} [opts] — cwd: the component root the tool runs in (config lookup, gradlew,
 *   detekt report); default the project root. tool: a detectTool() result; android picks gradle
 *   vs standalone detekt from it and detects it (cached) when absent. gradleTimeoutMs: a floor on
 *   timeoutMs that applies only to the gradle runner (background callers only — see
 *   GRADLE_BATCH_TIMEOUT_MS).
 * @returns {Promise<{ exitCode: number, findings: object[], rawOutput: string, durationMs: number,
 *   truncated: boolean, timeoutMs?: number, reports?: number, toolFailed?: boolean,
 *   missingTool?: boolean, toolError?: string }>}
 *   toolFailed: the run failed without producing a report (android) — NOT a clean pass.
 *   reports: android gradle runner — how many fresh detekt XML reports were read.
 */
async function runTool(platform, targetPath, opts = {}) {
  if (platform === 'android' && !opts.tool) {
    opts = { ...opts, tool: detectTool('android', opts.cwd ? { root: opts.cwd } : {}) };
  }
  const gradle = isGradleRunner(platform, opts.tool);
  let timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  if (gradle && opts.gradleTimeoutMs > timeoutMs) timeoutMs = opts.gradleTimeoutMs;

  // Mock mode: return canned output
  const mockOutput = process.env.BK_NATIVE_LINT_MOCK_OUTPUT;
  const mockExit   = process.env.BK_NATIVE_LINT_MOCK_EXIT;
  if (mockOutput !== undefined || mockExit !== undefined) {
    logMockCommand(platform, targetPath, opts);
    const rawOutput = mockOutput || '';
    const exitCode  = parseInt(mockExit || '0', 10);
    let findings    = parseOutput(platform, rawOutput);
    // P1-6: Even in mock mode, fall back to XML report file for android (detekt)
    // when stdout produces no findings — mirrors real-runtime behavior (no freshness check:
    // nothing ran, so every fixture report counts).
    const base = { exitCode, findings, rawOutput, durationMs: 0, truncated: false };
    if (platform === 'android' && findings.length === 0) {
      return withAndroidReports(base, targetPath, opts, {});
    }
    return withFailureFlags(platform, base, false);
  }

  const start = Date.now();

  let child;
  let rawOutput = '';
  let exitCode  = 0;

  const runPromise = new Promise((resolve) => {
    const { args, cmd } = buildCommand(platform, targetPath, opts);
    logMockCommand(platform, targetPath, opts);
    try {
      const execOpts = opts.cwd ? { maxBuffer: MAX_OUTPUT_CHARS, cwd: opts.cwd } : { maxBuffer: MAX_OUTPUT_CHARS };
      child = cp.execFile(cmd, args, execOpts, (err, stdout, stderr) => {
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
      return { exitCode: 124, findings: [], rawOutput: `Timed out after ${timeoutMs}ms`, durationMs: Date.now() - start, truncated: false, timeoutMs };
    }
    return { exitCode: 1, findings: [], rawOutput: e.message, durationMs: Date.now() - start, truncated: false };
  }

  const truncated = rawOutput.length >= MAX_OUTPUT_CHARS;
  const durationMs = Date.now() - start;
  let findings = parseOutput(platform, rawOutput);

  // P1-6: Detekt via gradlew writes XML to <module>/build/reports/detekt/*.xml, not stdout —
  // stdout is gradle build progress. If stdout parse yielded zero, read the report files. Only a
  // report this run wrote counts: an older one left in build/ would replay stale findings and
  // mask a failed run as a result.
  const base = { exitCode, findings, rawOutput, durationMs, truncated };
  if (platform === 'android' && findings.length === 0) {
    return withAndroidReports(base, targetPath, opts, { since: start });
  }
  return withFailureFlags(platform, base, false);
}

/** android + anything but the standalone CLI = `./gradlew detekt` (buildCommand's own rule). */
function isGradleRunner(platform, tool) {
  return platform === 'android' && !(tool && tool.runner === 'cli' && tool.path);
}

/**
 * Fill an android result's findings from detekt's XML report(s), then apply the failure flags.
 *
 * Gradle runner: every fresh report under the component root, findings scoped to the batch's
 * files (see lib/detekt-gradle-reports.cjs for the plugin facts). The detekt task FAILS when
 * issues exceed maxIssues (default 0) but still writes its reports — observed on 1.23.8 and
 * 2.0.0-alpha.6 ("Analysis failed with 1 weighted issues", exit 1, reports present) — so a
 * non-zero exit WITH a fresh report is an "issues found" result, even when none of the issues
 * are in this batch's files. Non-zero with no fresh report stays toolFailed.
 * Standalone CLI: the one report path it was told to write, as before.
 */
function withAndroidReports(base, targetPath, opts, { since }) {
  const root = opts.cwd || projectRoot();
  if (!isGradleRunner('android', opts.tool)) {
    const xml = readDetektXmlReport(opts.cwd, since ? { since } : {});
    const findings = xml ? parseOutput('android', xml) : base.findings;
    return withFailureFlags('android', { ...base, findings }, Boolean(xml));
  }
  const mockPath = process.env.BK_NATIVE_LINT_MOCK_DETEKT_XML_PATH;
  const reports = mockPath && fs.existsSync(mockPath)
    ? [{ path: mockPath, xml: fs.readFileSync(mockPath, 'utf8') }]
    : collectDetektReports(root, since ? { since } : {});
  const all = [];
  for (const r of reports) all.push(...parseOutput('android', r.xml));
  const findings = scopeFindings(all, toTargetList(targetPath), { root, projectRoot: projectRoot() });
  return withFailureFlags('android', { ...base, findings, reports: reports.length }, reports.length > 0);
}

/**
 * Lines of gradle / shell output that name why a detekt run failed, most specific first.
 * "Task 'detekt' not found" is the X-Game-Pro case (ktlint-only project, no detekt plugin).
 */
const FAILURE_REASON_RES = [
  /Task '[^']*' not found[^\n]*/,
  /Unknown command-line option '[^']*'/,
  MISSING_TOOL_RE,
  /FAILURE: [^\n]*/
];

/**
 * Field review 2026-11-25: on android a non-zero exit with nothing parseable and no XML report
 * used to come back as `findings: []`, which every caller reads as a clean pass — so a detekt
 * that never ran ("Task 'detekt' not found") was indistinguishable from clean code for the whole
 * review. Flag it instead: `toolFailed` (callers record a yellow signal / advisory, never a block)
 * and `missingTool` when the tool or task does not exist at all. Other platforms' linters exit
 * non-zero only alongside their findings, so they are left as they were.
 */
function withFailureFlags(platform, result, reportFound) {
  if (platform !== 'android') return result;
  const { exitCode, findings, rawOutput } = result;
  if (exitCode === 0 || exitCode === 124 || findings.length > 0 || reportFound) return result;
  const raw = String(rawOutput || '');
  let reason = '';
  for (const re of FAILURE_REASON_RES) {
    const m = raw.match(re);
    if (m) { reason = m[0]; break; }
  }
  if (!reason) reason = raw.split('\n').map((l) => l.trim()).filter(Boolean).pop() || `exit ${exitCode}`;
  const missingTool = exitCode === 127 || /Task '[^']*' not found/.test(raw) || MISSING_TOOL_RE.test(raw);
  return { ...result, toolFailed: true, missingTool, toolError: reason.slice(0, 200) };
}

/**
 * P1-6 helper: read the standalone detekt CLI's XML report (the gradle runner reads every
 * module's report instead — withAndroidReports).
 * Mock-friendly via BK_NATIVE_LINT_MOCK_DETEKT_XML_PATH env var.
 * @param {string} [componentRoot]
 * @param {{ since?: number }} [opts] — since: ignore reports last written before this epoch ms
 *   (1s slack for coarse filesystem mtimes)
 * @returns {string|null} XML content or null if not found
 */
function readDetektXmlReport(componentRoot, opts = {}) {
  // Mock override (for tests)
  const mockPath = process.env.BK_NATIVE_LINT_MOCK_DETEKT_XML_PATH;
  if (mockPath && fs.existsSync(mockPath)) {
    try { return fs.readFileSync(mockPath, 'utf8'); } catch { return null; }
  }
  const root = componentRoot || projectRoot();
  // Common detekt output paths (root project, app module, multi-module convention)
  const candidates = [
    path.join(root, 'build', 'reports', 'detekt', 'detekt.xml'),
    path.join(root, 'app', 'build', 'reports', 'detekt', 'detekt.xml'),
    path.join(root, 'build', 'reports', 'detekt', 'main.xml')
  ];
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      if (opts.since && fs.statSync(p).mtimeMs < opts.since - 1000) continue;
      return fs.readFileSync(p, 'utf8');
    } catch { /* continue */ }
  }
  return null;
}

/**
 * Normalize runTool/buildCommand's target argument to a list of paths.
 * A plain string stays a one-element list, so every existing caller is unchanged.
 * @param {string|string[]} targetPath
 * @returns {string[]}
 */
function toTargetList(targetPath) {
  if (Array.isArray(targetPath)) return targetPath.filter(Boolean).map(String);
  return targetPath ? [String(targetPath)] : [];
}

/**
 * Record the command that would run, for tests that must never shell out to a real
 * dart/swiftlint. No-op unless BK_LINT_MOCK_CMD_LOG points somewhere.
 */
function logMockCommand(platform, targetPath, opts) {
  const logPath = process.env.BK_LINT_MOCK_CMD_LOG;
  if (!logPath) return;
  try {
    const { cmd, args } = buildCommand(platform, targetPath, opts);
    fs.appendFileSync(logPath, [cmd, ...args].join(' ') + '\n', 'utf8');
  } catch { /* diagnostics are best-effort */ }
}

/**
 * Build the command + args for the given platform.
 *
 * @param {'ios'|'android'|'flutter'} platform
 * @param {string|string[]} targetPath — one path, or a batch of them in one run
 * @param {{ policy?: object, cwd?: string, tool?: object }} [opts] — tool: android's detectTool()
 *   result; runner 'cli' builds the standalone detekt invocation, anything else the gradlew one
 * @returns {{ cmd: string, args: string[] }}
 */
function buildCommand(platform, targetPath, opts = {}) {
  const policy = opts.policy || {};
  const targets = toTargetList(targetPath);
  switch (platform) {
    case 'ios': {
      const configPath = (policy.ios && policy.ios.config_path) || '.swiftlint.yml';
      const args = ['lint', '--quiet', '--reporter', 'json'];
      // Add config if it exists (in the component root the tool runs in — opts.cwd)
      const root = opts.cwd || projectRoot();
      if (fs.existsSync(path.join(root, configPath))) {
        args.push('--config', configPath);
      }
      // swiftlint takes any number of positional paths.
      args.push(...targets);
      return { cmd: 'swiftlint', args };
    }
    case 'android': {
      const root = opts.cwd || projectRoot();
      const tool = opts.tool || {};
      if (tool.runner === 'cli' && tool.path) {
        // Standalone detekt (no Gradle plugin): its own CLI flags. stdout is console text, so the
        // XML report goes to the first path readDetektXmlReport() checks.
        const args = ['--input', targets.join(','),
          '--report', `xml:${path.join(root, 'build', 'reports', 'detekt', 'detekt.xml')}`];
        const config = ['detekt.yml', path.join('config', 'detekt', 'detekt.yml')]
          .find((c) => fs.existsSync(path.join(root, c)));
        if (config) args.push('--config', path.join(root, config));
        return { cmd: tool.path, args };
      }
      // The Gradle plugin's `detekt` task takes no file list or format: its only command-line
      // options are --auto-correct / --rerun, and `./gradlew detekt --format xml --input …` fails
      // with "Unknown command-line option '--format'" (verified 2026-11-25 on plugin 1.23.8 and
      // 2.0.0-alpha.6, Gradle 9.9.1). It analyses every module that applies the plugin and writes
      // XML per module by default; withAndroidReports() collects those and scopes them to
      // `targets`. --continue: one module's "Analysis failed" must not skip the others' reports.
      // The plain `detekt` task, not detektMain: no compilation, so no compile failure to mask it.
      return { cmd: path.join(root, 'gradlew'), args: ['detekt', '--continue', '--quiet', '--console=plain'] };
    }
    case 'flutter': {
      return { cmd: 'dart', args: ['analyze', '--format=json', ...targets] };
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
  buildCommand,
  withTimeout,
  normalizeSeverity,
  GRADLE_BATCH_TIMEOUT_MS,
  // Internal exports for tests
  _getCachePath:  getCachePath,
  _readCache:     readCache,
  _writeCache:    writeCache,
  _getCached:     getCached
};
