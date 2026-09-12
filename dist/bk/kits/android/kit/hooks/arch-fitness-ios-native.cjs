#!/usr/bin/env node
/**
 * arch-fitness-ios-native.cjs — Native SwiftLint integration for iOS files.
 *
 * Trigger: PostToolUse Edit | Write (matcher: *.swift)
 * Purpose: Run SwiftLint on edited Swift files when available; fall back to
 *          the existing regex-based arch-fitness-ios.cjs hook when not.
 *
 * Exit codes:
 *   0 — pass (or non-blocking findings)
 *   2 — error findings AND policy.native_lint.ios.block_on_error === true
 *
 * Env overrides:
 *   BK_PROJECT_ROOT                     — override project root (test isolation)
 *   BK_HARNESS_POLICY_PATH              — override policy file path
 *   BK_HOOK_LOG_DISABLED=1              — suppress hook logger writes
 *   BK_NATIVE_LINT_MOCK_AVAILABLE=...   — mock tool detection
 *   BK_NATIVE_LINT_MOCK_OUTPUT=...      — mock tool output
 *   BK_NATIVE_LINT_MOCK_EXIT=...        — mock tool exit code
 *   BK_NATIVE_LINT_FORCE_UNAVAILABLE=1  — force fallback to regex hook
 *   BK_NATIVE_LINT_NO_CACHE=1           — bypass detection cache
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const cp   = require('child_process');

const libDir = path.join(__dirname, 'lib');
const { loadHarnessPolicy, trackRedSignal, trackWarnSignal, resolveMetricPath } = require(path.join(libDir, 'harness-policy-loader.cjs'));
const { detectTool, runTool } = require(path.join(libDir, 'native-lint-runner.cjs'));
const { appendJsonl: rotatorAppend } = require(path.join(libDir, 'jsonl-rotator.cjs'));

const HOOK_NAME   = 'arch-fitness-ios-native';
const SIGNAL_TYPE = 'native_lint_ios';

// ─── Stdin parser ──────────────────────────────────────────────────────────

function parseStdin(raw) {
  try {
    const event = JSON.parse(raw);
    const toolInput = event.tool_input || event.input || {};
    const filePath  = toolInput.file_path || toolInput.path || null;
    const content   = toolInput.new_string !== undefined
      ? toolInput.new_string
      : (toolInput.content || '');
    return { filePath, content, event };
  } catch {
    return null;
  }
}

// ─── JSONL writer ──────────────────────────────────────────────────────────

function writeFindings(findings, filePath, projectRoot) {
  try {
    const jsonlPath = resolveMetricPath('.bk-metrics/native-lint-ios.jsonl', projectRoot);
    const dir = path.dirname(jsonlPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const record = {
      ts:       Date.now(),
      hook:     HOOK_NAME,
      file:     filePath,
      findings: findings.slice(0, 200) // cap per-write
    };
    rotatorAppend(jsonlPath, JSON.stringify(record) + '\n');
  } catch { /* fail-open */ }
}

// ─── Fallback to regex hook ────────────────────────────────────────────────

function runRegexFallback(stdinData) {
  const regexHook = path.join(__dirname, 'arch-fitness-ios.cjs');
  try {
    const result = cp.spawnSync(process.execPath, [regexHook], {
      input: stdinData,
      stdio: ['pipe', 'pipe', 'pipe'],
      env:   process.env,
      timeout: 30000
    });
    if (result.stdout && result.stdout.length > 0) process.stdout.write(result.stdout);
    if (result.stderr && result.stderr.length > 0) process.stderr.write(result.stderr);
    return result.status || 0;
  } catch (e) {
    process.stderr.write(`[${HOOK_NAME}] Regex fallback error: ${e.message}\n`);
    return 0;
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  let stdinData = '';
  try {
    stdinData = fs.readFileSync(0, 'utf8');
  } catch {
    process.exit(0);
  }

  if (!stdinData || !stdinData.trim()) process.exit(0);

  const parsed = parseStdin(stdinData);
  if (!parsed || !parsed.filePath) process.exit(0);

  const { filePath } = parsed;

  // Only process Swift files
  if (!filePath.endsWith('.swift')) process.exit(0);

  // Load policy
  let policy;
  try {
    policy = loadHarnessPolicy();
  } catch {
    process.exit(0);
  }

  const projectRoot = policy.__projectRoot;
  const nativeCfg   = policy.native_lint || {};
  const iosCfg      = nativeCfg.ios || {};

  // Check if native lint is enabled
  if (nativeCfg.enabled === false || iosCfg.enabled === false) {
    // Disabled — run regex fallback
    process.exit(runRegexFallback(stdinData));
  }

  // Detect tool
  const toolInfo = detectTool('ios');

  if (!toolInfo.available || !nativeCfg.fallback_to_regex === false) {
    // Tool unavailable → fall back to regex hook
    if (!toolInfo.available) {
      process.stderr.write(`[${HOOK_NAME}] SwiftLint not available (${toolInfo.reason || 'unknown'}) — delegating to regex hook\n`);
      process.exit(runRegexFallback(stdinData));
    }
  }

  if (!toolInfo.available) {
    process.exit(runRegexFallback(stdinData));
  }

  // Run SwiftLint
  const timeoutMs = nativeCfg.timeout_ms || 30000;
  let result;
  try {
    result = await runTool('ios', filePath, { timeoutMs, policy: nativeCfg });
  } catch (e) {
    process.stderr.write(`[${HOOK_NAME}] runTool error: ${e.message} — delegating to regex hook\n`);
    process.exit(runRegexFallback(stdinData));
  }

  const { exitCode, findings, durationMs, truncated } = result;

  // Write findings to JSONL regardless
  if (findings.length > 0) {
    writeFindings(findings, filePath, projectRoot);
  }

  // Timeout or tool error → fail-open
  if (exitCode === 124) {
    process.stderr.write(`[${HOOK_NAME}] SwiftLint timed out (${timeoutMs}ms) — skipping\n`);
    process.exit(0);
  }

  // No findings
  if (findings.length === 0) process.exit(0);

  // Emit signal (red or yellow — see routing below)
  const errFindings  = findings.filter(f => f.severity === 'error');
  const warnFindings = findings.filter(f => f.severity === 'warning');
  const convFindings = findings.filter(f => f.severity === 'convention');

  // Route by severity. A warning-only run must not reach red-signals.jsonl: the kill switch
  // weighs every entry there, so a single unused import used to push the workflow toward a
  // full halt even though this hook is configured `block_on_error: false`. The warning is
  // still recorded — in yellow-signals.jsonl, where nothing counts it toward the halt.
  const signalMeta = {
    file:      filePath,
    errors:    errFindings.length,
    warnings:  warnFindings.length,
    durationMs,
    truncated
  };
  const redOnErrorOnly = nativeCfg.red_on_error_only !== false;

  try {
    if (!redOnErrorOnly || errFindings.length > 0) {
      trackRedSignal(SIGNAL_TYPE, signalMeta);
    } else {
      trackWarnSignal(SIGNAL_TYPE, signalMeta);
    }
  } catch { /* fail-open */ }

  // Format and emit
  process.stderr.write(`[${HOOK_NAME}] SwiftLint: ${findings.length} finding(s) in ${filePath}\n`);
  for (const f of findings.slice(0, 20)) {
    process.stderr.write(`  ${f.severity.toUpperCase()}: ${path.basename(f.file || filePath)}:${f.line} [${f.rule}] ${f.message}\n`);
  }
  if (findings.length > 20) {
    process.stderr.write(`  ... and ${findings.length - 20} more\n`);
  }

  // Block only if policy says so AND there are errors
  const blockOnError = iosCfg.block_on_error === true;
  if (blockOnError && errFindings.length > 0) {
    process.stderr.write(`[${HOOK_NAME}] BLOCKED: ${errFindings.length} SwiftLint error(s). Fix before proceeding.\n`);
    process.exit(2);
  }

  // Non-blocking
  process.exit(0);
}

main().catch(err => {
  process.stderr.write(`[${HOOK_NAME}] Unexpected error (fail-open): ${err.message}\n`);
  process.exit(0);
});
