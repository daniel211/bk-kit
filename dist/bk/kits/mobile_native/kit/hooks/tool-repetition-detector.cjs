#!/usr/bin/env node
// tool-repetition-detector.cjs - PreToolUse hook detecting repeated identical tool calls.
// Triggers on all tools ("*"). Hash-based ring buffer detection.
// Fail-open on crash.

'use strict';

try {
  const fs = require('fs');
  const path = require('path');
  const crypto = require('crypto');

  const { loadHarnessPolicy, trackRedSignal, trackViolation, resolveMetricPath } = require('./lib/harness-policy-loader.cjs');
  const { isHookEnabled } = require('./lib/bk-config-utils.cjs');

  /**
   * Compute canonical SHA-256 hash of tool call (tool_name + sorted args).
   */
  function computeHash(toolName, toolInput) {
    const canonical = JSON.stringify(
      { tool: toolName, args: sortedKeys(toolInput) },
      null,
      0
    );
    return crypto.createHash('sha256').update(canonical).digest('hex');
  }

  function sortedKeys(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
    const result = {};
    for (const k of Object.keys(obj).sort()) {
      result[k] = sortedKeys(obj[k]);
    }
    return result;
  }

  /**
   * Load ring buffer from file. Reset if session/turn changed.
   */
  function loadRing(ringFile, sessionId, turnId) {
    try {
      if (fs.existsSync(ringFile)) {
        const data = JSON.parse(fs.readFileSync(ringFile, 'utf8'));
        if (data && data.session_id === sessionId && data.turn_id === turnId) {
          return data;
        }
        // Turn changed — reset
      }
    } catch { /* corrupt or missing — start fresh */ }
    return { session_id: sessionId, turn_id: turnId, entries: [] };
  }

  /**
   * Save ring buffer atomically (tempfile + rename).
   */
  function saveRing(ringFile, ring) {
    const dir = path.dirname(ringFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = ringFile + '.' + Math.random().toString(36).slice(2);
    try {
      fs.writeFileSync(tmp, JSON.stringify(ring), 'utf8');
      fs.renameSync(tmp, ringFile);
    } catch {
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    }
  }

  function argsPreview(toolInput) {
    try { return JSON.stringify(toolInput).slice(0, 200); } catch { return ''; }
  }

  async function main() {
    // Read stdin using async stream (works with piped input in tests)
    let raw = '';
    try {
      for await (const chunk of process.stdin) raw += chunk;
    } catch { process.exit(0); }

    let input = {};
    try { input = JSON.parse(raw || '{}'); } catch { process.exit(0); }

    const toolName = input.tool_name || '';
    const toolInput = input.tool_input || {};
    const sessionId = input.session_id || process.env.CLAUDE_SESSION_ID || 'unknown';
    const turnId = input.turn_id || process.env.CLAUDE_TURN_ID || '0';

    // Check if hook enabled
    if (!isHookEnabled('tool-repetition-detector')) {
      process.exit(0);
    }

    const policy = loadHarnessPolicy();
    const cfg = policy.deadloop.tool_repetition;
    if (!cfg.enabled) process.exit(0);

    // Check exempt tools
    const exemptTools = cfg.exempt_tools || [];
    if (exemptTools.includes(toolName)) process.exit(0);

    // Override env bypass
    if (process.env.BK_HARNESS_OVERRIDE === '1') process.exit(0);

    const windowSize = cfg.window_size || 10;
    const warnThreshold = cfg.warn_threshold || 3;
    const blockThreshold = cfg.block_threshold || 5;

    const ringFile = resolveMetricPath(cfg.ring_file || '.bk-metrics/tool-call-ring.json');

    // Compute hash for this call
    const hash = computeHash(toolName, toolInput);

    // Load ring
    const ring = loadRing(ringFile, sessionId, turnId);

    // Add new entry
    ring.entries.push({
      ts: Date.now(),
      tool: toolName,
      hash,
      args_preview: argsPreview(toolInput)
    });

    // Trim to window size
    if (ring.entries.length > windowSize) {
      ring.entries = ring.entries.slice(-windowSize);
    }

    // Save ring
    saveRing(ringFile, ring);

    // Count how many recent entries match this hash
    const recentCount = ring.entries.filter(e => e.hash === hash).length;

    if (recentCount >= blockThreshold) {
      // BLOCK
      const reason = `DEADLOOP DETECTED — tool "${toolName}" called ${recentCount} times with identical arguments.\n\n` +
        `STOP retry. Làm CHÍNH XÁC các bước sau, theo đúng thứ tự:\n` +
        `1. Đọc lại output của 2 lần gọi trước đó. So sánh điểm KHÁC BIỆT kỳ vọng vs thực tế.\n` +
        `2. Nếu output không đổi — approach của bạn sai về bản chất. Làm:\n` +
        `   a. Dispatch bk-problem-solving với technique "Simplification Cascades"\n` +
        `   b. HOẶC dispatch bk-brainstormer để thử approach khác hoàn toàn\n` +
        `3. KHÔNG được gọi lại tool "${toolName}" với arguments tương tự trong 5 turn tới.\n\n` +
        `Override (CHỈ khi user yêu cầu): set BK_HARNESS_OVERRIDE=1 trong env.\n` +
        `Ring buffer: ${ringFile} (last ${windowSize} calls)`;

      process.stderr.write(`[tool-repetition-detector] BLOCK: ${toolName} called ${recentCount}x (hash=${hash.slice(0, 8)})\n`);

      // Track signals
      trackRedSignal('tool_repetition_blocked', { tool: toolName, count: recentCount, hash: hash.slice(0, 16) });
      trackViolation({
        hook: 'tool-repetition-detector',
        violation_type: 'tool_repetition',
        tool: toolName,
        blocked: true,
        severity: 'red',
        context: { count: recentCount, hash: hash.slice(0, 16) }
      });

      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: reason
        }
      }) + '\n');
      process.exit(2);
    }

    if (recentCount >= warnThreshold) {
      // WARN — advisory only, exit 0
      process.stderr.write(
        `[tool-repetition-detector] WARN: tool "${toolName}" called ${recentCount}x with same args. ` +
        `Block at ${blockThreshold}. Consider different approach.\n`
      );
      process.exit(0);
    }

    process.exit(0);
  }

  main().catch(() => process.exit(0));
} catch (e) {
  // Fail-open on crash
  try {
    process.stderr.write(`[tool-repetition-detector] CRASH (fail-open): ${e.message}\n`);
  } catch { /* ignore */ }
  process.exit(0);
}
