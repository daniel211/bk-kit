/**
 * arch-rule-runner.cjs — Shared rule-runner framework for architecture fitness functions.
 *
 * Runs a set of architecture rules against file content and returns violations.
 *
 * Rule interface:
 *   {
 *     id: string,
 *     severity: 'error' | 'warning',
 *     check(ctx: RuleContext): Violation[] | null
 *   }
 *
 * RuleContext:
 *   { content, filePath, config, layerInfo, lines, platform }
 *
 * Violation:
 *   { ruleId, severity, filePath, line, col, message, fix, match }
 *
 * Usage:
 *   const { runRules } = require('./arch-rule-runner.cjs');
 *   const violations = runRules(content, filePath, rules, platformConfig, skipRuleIds);
 */

'use strict';

const { classifyLayer } = require('./layer-classifier.cjs');

/**
 * Split content into lines (cached on ctx).
 * @param {string} content
 * @returns {string[]}
 */
function splitLines(content) {
  return content.split('\n');
}

/**
 * Build a Violation object.
 * @param {string} ruleId
 * @param {string} severity
 * @param {string} filePath
 * @param {number} line  — 1-based
 * @param {string} message
 * @param {string} [fix]
 * @param {string} [match]
 * @returns {object}
 */
function makeViolation(ruleId, severity, filePath, line, message, fix, match) {
  return {
    ruleId,
    severity,
    filePath,
    line: line || 0,
    message,
    fix: fix || null,
    match: match || null
  };
}

/**
 * Run all enabled rules against file content.
 *
 * @param {string} content — file content string
 * @param {string} filePath — path to the file (used for layer classification + error messages)
 * @param {Array<{id, severity, check}>} rules — rule definitions
 * @param {object} platformConfig — policy.arch_fitness[platform]
 * @param {string[]} [skipIds] — rule IDs to skip (from BK_ARCH_FITNESS_SKIP env)
 * @param {string} [platform] — platform name ('ios'|'android'|'flutter')
 * @returns {Array<object>} violations
 */
function runRules(content, filePath, rules, platformConfig, skipIds, platform) {
  if (!content || !filePath || !rules || !rules.length) return [];

  const skipSet = new Set(skipIds || []);
  const lines = splitLines(content);
  const layerInfo = classifyLayer(filePath, platformConfig || {});

  // If file is excluded, skip all checks
  if (layerInfo.excluded) return [];

  const ctx = {
    content,
    filePath,
    config: platformConfig || {},
    layerInfo,
    lines,
    platform: platform || 'unknown'
  };

  const allViolations = [];

  for (const rule of rules) {
    if (!rule || !rule.id) continue;

    // Skip if disabled in policy
    const ruleConfig = (platformConfig && platformConfig.rules && platformConfig.rules[rule.id]) || {};
    if (ruleConfig.enabled === false) continue;

    // Skip if in env-override skip list
    if (skipSet.has(rule.id)) continue;

    // Determine effective severity (policy can override rule default)
    const effectiveSeverity = ruleConfig.severity || rule.severity || 'warning';

    let violations = [];
    try {
      const result = rule.check(ctx, ruleConfig);
      if (Array.isArray(result)) {
        violations = result;
      } else if (result) {
        violations = [result];
      }
    } catch (err) {
      // Fail-open: rule error should not block edit
      process.stderr.write(`[arch-rule-runner] Rule ${rule.id} threw: ${err.message}\n`);
      continue;
    }

    // Apply effective severity from policy (override rule's built-in severity)
    for (const v of violations) {
      v.severity = effectiveSeverity;
      if (!v.ruleId) v.ruleId = rule.id;
      allViolations.push(v);
    }
  }

  return allViolations;
}

/**
 * Format violations into a human-readable block string suitable for stderr.
 *
 * @param {Array<object>} violations
 * @param {string} hookName
 * @returns {string}
 */
function formatViolations(violations, hookName) {
  if (!violations || !violations.length) return '';
  const lines = [];
  for (const v of violations) {
    const level = v.severity === 'error' ? 'ERROR' : 'WARNING';
    const location = v.line ? `${v.filePath}:${v.line}` : v.filePath;
    lines.push(`[${hookName}] ${level}: ${v.ruleId} violation`);
    lines.push(`  File: ${location}`);
    if (v.match) lines.push(`  Found: ${v.match}`);
    lines.push(`  Rule: ${v.message}`);
    if (v.fix) lines.push(`  Fix: ${v.fix}`);
    lines.push(`  Override: BK_ARCH_FITNESS_SKIP=${v.ruleId} (not recommended)`);
    lines.push('');
  }
  return lines.join('\n');
}

module.exports = { runRules, makeViolation, formatViolations, splitLines };
