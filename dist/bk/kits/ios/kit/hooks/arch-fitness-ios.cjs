#!/usr/bin/env node
/**
 * arch-fitness-ios.cjs — Architecture fitness hook for Swift/iOS files.
 *
 * Trigger: PostToolUse Edit | Write (matcher: *.swift)
 * Purpose: Enforce Clean Architecture + MVVM rules on every Swift file edit.
 *
 * Exit codes:
 *   0 — pass (no errors)
 *   1 — warnings only (non-blocking)
 *   2 — error violations found (BLOCK edit, agent must fix)
 *
 * Env vars:
 *   BK_ARCH_FITNESS_SKIP=rule1,rule2  — skip specific rules (comma-separated)
 *   BK_PROJECT_ROOT                   — override project root (test isolation)
 *   BK_HARNESS_POLICY_PATH            — override policy file path
 */

'use strict';

const fs = require('fs');
const path = require('path');

const libDir = path.join(__dirname, 'lib');
const { loadHarnessPolicy, trackViolation, resolveMetricPath } = require(path.join(libDir, 'harness-policy-loader.cjs'));
const { runRules, formatViolations } = require(path.join(libDir, 'arch-rule-runner.cjs'));
const { IOS_RULES } = require(path.join(libDir, 'arch-rules-ios.cjs'));

const HOOK_NAME = 'arch-fitness-ios';

/**
 * Parse PostToolUse stdin event JSON.
 * Returns { filePath, content } or null on error.
 */
function parseStdin(raw) {
  try {
    const event = JSON.parse(raw);
    const toolInput = event.tool_input || event.input || {};
    const filePath = toolInput.file_path || toolInput.path || null;
    // For Edit tool: new_string is the replacement. For Write tool: content is the full content.
    const content = toolInput.new_string !== undefined
      ? toolInput.new_string
      : (toolInput.content || '');
    return { filePath, content, event };
  } catch {
    return null;
  }
}

/**
 * Read file content from disk (fallback when new_string is not in stdin).
 */
function readFileContent(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf8');
    }
  } catch { /* fail-open */ }
  return null;
}

/**
 * Main entry point.
 */
async function main() {
  // Use fd 0 instead of '/dev/stdin' for cross-environment compatibility:
  // works with shell pipes AND Node-spawned child pipes (the latter fails
  // with ENXIO when reading '/dev/stdin').
  let stdinData = '';
  try {
    stdinData = fs.readFileSync(0, 'utf8');
  } catch {
    // No stdin — exit cleanly (e.g. invoked directly)
    process.exit(0);
  }

  if (!stdinData || !stdinData.trim()) process.exit(0);

  const parsed = parseStdin(stdinData);
  if (!parsed || !parsed.filePath) process.exit(0);

  const { filePath, content: stdinContent } = parsed;

  // Only process Swift files
  if (!filePath.endsWith('.swift')) process.exit(0);

  // Load policy
  const policy = loadHarnessPolicy();
  const platformConfig = policy.arch_fitness && policy.arch_fitness.ios;
  if (!platformConfig || !platformConfig.enabled) process.exit(0);

  // Check exclude paths
  const excludePaths = platformConfig.exclude_paths || [];
  if (excludePaths.some(ep => filePath.includes(ep))) process.exit(0);

  // Get file content — prefer stdin (the new content), fallback to disk
  let content = stdinContent;
  if (!content) {
    content = readFileContent(filePath);
  }
  if (!content) process.exit(0);

  // Parse skip rules from env
  const skipEnv = process.env.BK_ARCH_FITNESS_SKIP || '';
  const skipIds = skipEnv ? skipEnv.split(',').map(s => s.trim()).filter(Boolean) : [];

  // Run rules
  const allViolations = runRules(content, filePath, IOS_RULES, platformConfig, skipIds, 'ios');

  // Same warning on the same construct is reported once per session window, whatever line it is on.
  // Optional lib: a hook must never crash on it — fall back to reporting everything.
  let violations = allViolations;
  try {
    const { filterRepeatedWarnings } = require(path.join(libDir, 'arch-violation-dedupe.cjs'));
    violations = filterRepeatedWarnings(allViolations, {
      sessionId: parsed.event && (parsed.event.session_id || parsed.event.sessionId),
      cwd: parsed.event && parsed.event.cwd
    });
  } catch { /* unfiltered */ }

  if (violations.length === 0) process.exit(0);

  // Track all violations
  for (const v of violations) {
    try {
      trackViolation({
        hook: HOOK_NAME,
        violation_type: v.ruleId,
        target: filePath,
        severity: v.severity,
        line: v.line,
        context: v.match ? v.match.slice(0, 100) : null,
        blocked: v.severity === 'error'
      });
    } catch { /* fail-open */ }
  }

  // Separate errors from warnings
  const errors = violations.filter(v => v.severity === 'error');
  const warnings = violations.filter(v => v.severity === 'warning');

  // Always output formatted violations to stderr
  const allOutput = formatViolations(violations, HOOK_NAME);
  if (allOutput) process.stderr.write(allOutput);

  if (errors.length > 0) {
    // Block: exit 2
    process.stderr.write(`[${HOOK_NAME}] BLOCKED: ${errors.length} error violation(s) found. Fix before proceeding.\n`);
    process.exit(2);
  }

  // Warnings only — allow but notify
  if (warnings.length > 0) {
    process.stderr.write(`[${HOOK_NAME}] ${warnings.length} warning(s) — consider fixing for code quality.\n`);
  }

  process.exit(0);
}

main().catch(err => {
  process.stderr.write(`[${HOOK_NAME}] Unexpected error: ${err.message}\n`);
  process.exit(0); // Fail-open
});
