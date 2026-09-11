#!/usr/bin/env node
// no-progress-detector.cjs - PostToolUse Edit|Write hook.
// Detects file oscillation (A→B→A→B) and trivial-edit spam.
// Fail-open on crash.

'use strict';

try {
  const fs = require('fs');
  const path = require('path');
  const crypto = require('crypto');

  const { loadHarnessPolicy, trackRedSignal, trackViolation, resolveMetricPath, appendJsonl } = require('./lib/harness-policy-loader.cjs');
  const { isHookEnabled } = require('./lib/bk-config-utils.cjs');

  /**
   * Compute SHA-256 of string content.
   */
  function computeSha(content) {
    if (!content || typeof content !== 'string') return 'empty';
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Determine if a diff between old and new content is trivial (whitespace/comment only).
   */
  function isTrivialDiff(oldStr, newStr) {
    if (typeof oldStr !== 'string' || typeof newStr !== 'string') return false;
    const stripTrivia = (s) => s
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/\/?[^\n]*/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return stripTrivia(oldStr) === stripTrivia(newStr);
  }

  /**
   * Read recent entries for a specific file from the JSONL history.
   */
  function readFileHistory(historyFile, targetFile, limit = 200) {
    const results = [];
    if (!fs.existsSync(historyFile)) return results;
    try {
      const raw = fs.readFileSync(historyFile, 'utf8');
      const lines = raw.split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry && entry.file === targetFile) results.push(entry);
        } catch { /* skip corrupt lines */ }
      }
      return results.slice(-limit);
    } catch { return results; }
  }

  /**
   * Detect oscillation: in recent window, ≤ 2 unique new_hashes for same file.
   */
  function detectOscillation(history, windowSize, threshold) {
    const recent = history.slice(-windowSize);
    if (recent.length < threshold) return null;
    const uniqueHashes = new Set(recent.map(e => e.new_hash));
    if (uniqueHashes.size <= 2 && uniqueHashes.size > 0) {
      return {
        type: 'oscillation_blocked',
        shas: Array.from(uniqueHashes),
        count: recent.length,
        hint:
          'File oscillating giữa 2 trạng thái. Nguyên nhân thường là 2 agent ' +
          'mâu thuẫn hoặc bạn đang hủy chính edit trước đó. ' +
          'HÀNH ĐỘNG: dispatch bk-code-reviewer để quyết định approach cuối cùng. ' +
          'Tránh edit file này cho tới khi có decision log.'
      };
    }
    return null;
  }

  /**
   * Detect trivial edit spam: last N consecutive edits are all trivial.
   */
  function detectTrivialSpam(history, threshold) {
    const recent = history.slice(-threshold);
    if (recent.length < threshold) return null;
    if (recent.every(e => e.trivial)) {
      return {
        type: 'trivial_edits_only',
        count: recent.length,
        hint:
          `Agent đã edit file này ${threshold} lần nhưng chỉ thay đổi whitespace/comment. Logic không thay đổi. ` +
          'HÀNH ĐỘNG: đọc lại mục tiêu edit ban đầu. Nếu cần thay đổi semantic, ' +
          'hãy làm trực tiếp; nếu không còn việc thì STOP edit file này.'
      };
    }
    return null;
  }

  async function main() {
    // Read stdin via stream (compatible with piped input in test environments)
    let raw = '';
    try {
      for await (const chunk of process.stdin) raw += chunk;
    } catch { process.exit(0); }

    let input = {};
    try { input = JSON.parse(raw || '{}'); } catch { process.exit(0); }

    if (!isHookEnabled('no-progress-detector')) process.exit(0);

    const policy = loadHarnessPolicy();
    const cfg = policy.deadloop.no_progress;
    if (!cfg.enabled) process.exit(0);

    const toolName = input.tool_name || '';
    const toolInput = input.tool_input || {};

    // Only process Edit and Write
    if (toolName !== 'Edit' && toolName !== 'Write') process.exit(0);

    // Extract file path
    const filePath = toolInput.file_path || toolInput.path || '';
    if (!filePath) process.exit(0);

    // Normalize file path for history key
    const normFile = path.resolve(filePath);

    // Extract content info
    let oldStr = '';
    let newStr = '';

    if (toolName === 'Edit') {
      oldStr = toolInput.old_string || '';
      newStr = toolInput.new_string || '';
    } else {
      // Write: content is the full new content
      newStr = toolInput.content || '';
    }

    const oldHash = computeSha(oldStr);
    const newHash = computeSha(newStr);
    const diffSize = Math.abs(newStr.length - oldStr.length);
    const trivial = isTrivialDiff(oldStr, newStr);

    const historyFile = resolveMetricPath(cfg.file_edit_history || '.bk-metrics/file-edit-history.jsonl');

    // Append entry
    const entry = {
      ts: Date.now(),
      file: normFile,
      old_hash: oldHash,
      new_hash: newHash,
      diff_size: diffSize,
      trivial
    };
    appendJsonl(historyFile, entry);

    // Read recent history for this file
    const history = readFileHistory(historyFile, normFile, 200);

    const oscillationWindow = cfg.oscillation_window || 6;
    const oscillationThreshold = cfg.oscillation_block_threshold || 4;
    const trivialMax = cfg.trivial_edit_max_chars !== undefined ? cfg.trivial_edit_max_chars : 20;
    const trivialThreshold = cfg.trivial_edit_block_threshold || 5;

    // Check oscillation
    const oscResult = detectOscillation(history, oscillationWindow, oscillationThreshold);
    if (oscResult) {
      process.stderr.write(
        `[no-progress-detector] BLOCK oscillation on ${path.basename(normFile)}: ` +
        `${oscResult.count} edits with ≤2 unique hashes\n`
      );

      trackRedSignal('oscillation_blocked', { file: normFile, count: oscResult.count });
      trackViolation({
        hook: 'no-progress-detector',
        violation_type: 'oscillation_blocked',
        tool: toolName,
        target: normFile,
        blocked: true,
        severity: 'red',
        context: { shas: oscResult.shas, count: oscResult.count }
      });

      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: `FILE OSCILLATION DETECTED on ${path.basename(normFile)}\n\n${oscResult.hint}`
        }
      }) + '\n');
      process.exit(2);
    }

    // Check trivial spam (when diff_size is small OR content is trivial)
    if (diffSize <= trivialMax || trivial) {
      const trivialResult = detectTrivialSpam(history, trivialThreshold);
      if (trivialResult) {
        process.stderr.write(
          `[no-progress-detector] BLOCK trivial-spam on ${path.basename(normFile)}: ` +
          `${trivialResult.count} trivial edits in a row\n`
        );

        trackRedSignal('trivial_edits_blocked', { file: normFile, count: trivialResult.count });
        trackViolation({
          hook: 'no-progress-detector',
          violation_type: 'trivial_edits_only',
          tool: toolName,
          target: normFile,
          blocked: true,
          severity: 'yellow',
          context: { count: trivialResult.count }
        });

        process.stdout.write(JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PostToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: `TRIVIAL EDIT SPAM DETECTED on ${path.basename(normFile)}\n\n${trivialResult.hint}`
          }
        }) + '\n');
        process.exit(2);
      }
    }

    process.exit(0);
  }

  main().catch(() => process.exit(0));
} catch (e) {
  try {
    process.stderr.write(`[no-progress-detector] CRASH (fail-open): ${e.message}\n`);
  } catch { /* ignore */ }
  process.exit(0);
}
