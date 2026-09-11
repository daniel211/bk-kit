#!/usr/bin/env node
/**
 * arch-fitness-flutter-native.cjs — Native dart analyze integration for Flutter files.
 *
 * Trigger: PostToolUse Edit | Write (matcher: *.dart)
 * Purpose: Run `dart analyze` on edited Dart files when available; fall back to
 *          the existing regex-based arch-fitness-flutter.cjs hook when not.
 *
 * Exit codes:
 *   0 — pass (or non-blocking findings)
 *   2 — error findings AND policy.native_lint.flutter.block_on_error === true
 *
 * Env overrides:
 *   BK_PROJECT_ROOT                     — override project root
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
const { loadHarnessPolicy, trackRedSignal, resolveMetricPath } = require(path.join(libDir, 'harness-policy-loader.cjs'));
const { detectTool, runTool } = require(path.join(libDir, 'native-lint-runner.cjs'));
const { appendJsonl: rotatorAppend } = require(path.join(libDir, 'jsonl-rotator.cjs'));

const HOOK_NAME   = 'arch-fitness-flutter-native';
const SIGNAL_TYPE = 'native_lint_flutter';

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
    const jsonlPath = resolveMetricPath('.bk-metrics/native-lint-flutter.jsonl', projectRoot);
    const dir = path.dirname(jsonlPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const record = {
      ts:       Date.now(),
      hook:     HOOK_NAME,
      file:     filePath,
      findings: findings.slice(0, 200)
    };
    rotatorAppend(jsonlPath, JSON.stringify(record) + '\n');
  } catch { /* fail-open */ }
}

// ─── Fallback to regex hook ────────────────────────────────────────────────

function runRegexFallback(stdinData) {
  const regexHook = path.join(__dirname, 'arch-fitness-flutter.cjs');
  try {
    const result = cp.spawnSync(process.execPath, [regexHook], {
      input:   stdinData,
      stdio:   ['pipe', 'pipe', 'pipe'],
      env:     process.env,
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

  // Only process Dart files
  if (!filePath.endsWith('.dart')) process.exit(0);

  // Load policy
  let policy;
  try {
    policy = loadHarnessPolicy();
  } catch {
    process.exit(0);
  }

  const projectRoot = policy.__projectRoot;
  const nativeCfg   = policy.native_lint || {};
  const flutterCfg  = nativeCfg.flutter || {};

  // Check if native lint is enabled
  if (nativeCfg.enabled === false || flutterCfg.enabled === false) {
    process.exit(runRegexFallback(stdinData));
  }

  // Detect dart tool
  const toolInfo = detectTool('flutter');

  if (!toolInfo.available) {
    process.stderr.write(`[${HOOK_NAME}] dart not available (${toolInfo.reason || 'unknown'}) — delegating to regex hook\n`);
    process.exit(runRegexFallback(stdinData));
  }

  // Run dart analyze
  const timeoutMs = nativeCfg.timeout_ms || 30000;
  let result;
  try {
    result = await runTool('flutter', filePath, { timeoutMs, policy: nativeCfg });
  } catch (e) {
    process.stderr.write(`[${HOOK_NAME}] runTool error: ${e.message} — delegating to regex hook\n`);
    process.exit(runRegexFallback(stdinData));
  }

  const { exitCode, findings, durationMs, truncated } = result;

  // Timeout
  if (exitCode === 124) {
    process.stderr.write(`[${HOOK_NAME}] dart analyze timed out (${timeoutMs}ms) — skipping\n`);
    process.exit(0);
  }

  // Write findings
  if (findings.length > 0) {
    writeFindings(findings, filePath, projectRoot);
  }

  // No findings
  if (findings.length === 0) process.exit(0);

  // Emit red signal
  const errFindings  = findings.filter(f => f.severity === 'error');
  const warnFindings = findings.filter(f => f.severity === 'warning');

  try {
    trackRedSignal(SIGNAL_TYPE, {
      file:      filePath,
      errors:    errFindings.length,
      warnings:  warnFindings.length,
      durationMs,
      truncated
    });
  } catch { /* fail-open */ }

  // Format and emit
  process.stderr.write(`[${HOOK_NAME}] dart analyze: ${findings.length} finding(s) in ${filePath}\n`);
  for (const f of findings.slice(0, 20)) {
    process.stderr.write(`  ${f.severity.toUpperCase()}: ${path.basename(f.file || filePath)}:${f.line} [${f.rule}] ${f.message}\n`);
  }
  if (findings.length > 20) {
    process.stderr.write(`  ... and ${findings.length - 20} more\n`);
  }

  // Block only if policy says so AND there are errors
  const blockOnError = flutterCfg.block_on_error === true;
  if (blockOnError && errFindings.length > 0) {
    process.stderr.write(`[${HOOK_NAME}] BLOCKED: ${errFindings.length} dart analyze error(s). Fix before proceeding.\n`);
    process.exit(2);
  }

  process.exit(0);
}

main().catch(err => {
  process.stderr.write(`[${HOOK_NAME}] Unexpected error (fail-open): ${err.message}\n`);
  process.exit(0);
});
