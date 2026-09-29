#!/usr/bin/env node
/**
 * arch-fitness-flutter.cjs — Architecture fitness hook for Dart/Flutter files.
 *
 * Trigger: PostToolUse Edit | Write (matcher: *.dart)
 * Purpose: Enforce Clean Architecture + Riverpod rules on every Dart file edit.
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
const { loadHarnessPolicy, trackViolation } = require(path.join(libDir, 'harness-policy-loader.cjs'));
const { runRules, formatViolations } = require(path.join(libDir, 'arch-rule-runner.cjs'));
const { FLUTTER_RULES } = require(path.join(libDir, 'arch-rules-flutter.cjs'));

const HOOK_NAME = 'arch-fitness-flutter';

/**
 * Parse PostToolUse stdin event JSON.
 */
function parseStdin(raw) {
  try {
    const event = JSON.parse(raw);
    const toolInput = event.tool_input || event.input || {};
    const filePath = toolInput.file_path || toolInput.path || null;
    const content = toolInput.new_string !== undefined
      ? toolInput.new_string
      : (toolInput.content || '');
    return { filePath, content, event };
  } catch {
    return null;
  }
}

function readFileContent(filePath) {
  try {
    if (fs.existsSync(filePath)) return fs.readFileSync(filePath, 'utf8');
  } catch { /* fail-open */ }
  return null;
}

async function main() {
  let stdinData = '';
  try {
    // fd 0 works with both shell pipes and Node-spawned child pipes;
    // '/dev/stdin' fails with ENXIO on Node-spawned child pipes.
    stdinData = fs.readFileSync(0, 'utf8');
  } catch {
    process.exit(0);
  }

  if (!stdinData || !stdinData.trim()) process.exit(0);

  const parsed = parseStdin(stdinData);
  if (!parsed || !parsed.filePath) process.exit(0);

  const { filePath, content: stdinContent } = parsed;

  // Only process Dart files
  if (!filePath.endsWith('.dart')) process.exit(0);

  // Load policy
  const policy = loadHarnessPolicy();
  const platformConfig = policy.arch_fitness && policy.arch_fitness.flutter;
  if (!platformConfig || !platformConfig.enabled) process.exit(0);

  // Check exclude paths — also check filename suffixes for generated files
  const excludePaths = platformConfig.exclude_paths || [];
  const fileName = path.basename(filePath);
  const isExcluded = excludePaths.some(ep => {
    if (ep.startsWith('.') && fileName.endsWith(ep)) return true;
    return filePath.includes(ep);
  });
  if (isExcluded) process.exit(0);

  // Get file content
  let content = stdinContent;
  if (!content) content = readFileContent(filePath);
  if (!content) process.exit(0);

  // Parse skip rules
  const skipEnv = process.env.BK_ARCH_FITNESS_SKIP || '';
  const skipIds = skipEnv ? skipEnv.split(',').map(s => s.trim()).filter(Boolean) : [];

  // Run rules
  const allViolations = runRules(content, filePath, FLUTTER_RULES, platformConfig, skipIds, 'flutter');

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

  // Track violations
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

  const errors = violations.filter(v => v.severity === 'error');
  const warnings = violations.filter(v => v.severity === 'warning');

  const allOutput = formatViolations(violations, HOOK_NAME);
  if (allOutput) process.stderr.write(allOutput);

  if (errors.length > 0) {
    process.stderr.write(`[${HOOK_NAME}] BLOCKED: ${errors.length} error violation(s) found. Fix before proceeding.\n`);
    process.exit(2);
  }

  if (warnings.length > 0) {
    process.stderr.write(`[${HOOK_NAME}] ${warnings.length} warning(s) — consider fixing for code quality.\n`);
  }

  process.exit(0);
}

main().catch(err => {
  process.stderr.write(`[${HOOK_NAME}] Unexpected error: ${err.message}\n`);
  process.exit(0);
});
