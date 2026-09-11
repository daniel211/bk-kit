#!/usr/bin/env node
// global-kill-switch.cjs - PreToolUse "*" hook (runs FIRST).
// Aggregates red signals and triggers global halt when threshold exceeded.
// Fail-open on crash.

'use strict';

try {
  const fs = require('fs');
  const path = require('path');

  const {
    loadHarnessPolicy,
    readRecentRedSignals,
    resolveMetricPath,
    appendJsonl
  } = require('./lib/harness-policy-loader.cjs');
  const { isHookEnabled, readWorkflowState, writeWorkflowState } = require('./lib/bk-config-utils.cjs');

  // Read-only tools always allowed even during halt
  const READ_ONLY_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'TodoRead']);

  /**
   * Count distinct active red signal types within lookback window.
   */
  function countActiveRedSignals(lookbackMinutes) {
    const signals = readRecentRedSignals(lookbackMinutes);
    const uniqueTypes = new Set();
    for (const s of signals) {
      if (s.type) uniqueTypes.add(s.type);
    }
    return { count: uniqueTypes.size, types: Array.from(uniqueTypes) };
  }

  async function main() {
    // Read stdin via stream
    let raw = '';
    try {
      for await (const chunk of process.stdin) raw += chunk;
    } catch { process.exit(0); }

    let input = {};
    try { input = JSON.parse(raw || '{}'); } catch { process.exit(0); }

    if (!isHookEnabled('global-kill-switch')) process.exit(0);

    const policy = loadHarnessPolicy();
    const cfg = policy.kill_switch;
    if (!cfg.enabled) process.exit(0);

    const toolName = input.tool_name || '';

    // Always allow read-only tools
    if (READ_ONLY_TOOLS.has(toolName)) process.exit(0);

    // Self-recovery: allow canonical bk-health recovery commands even during halt
    if (toolName === 'Bash') {
      const cmd = (input.tool_input && input.tool_input.command) || '';
      if (/\bbk-health\/index\.cjs\b.*--(resume|reset-counts|checkpoint|dashboard|timeline|ashby|tier-advice)\b/.test(cmd)) {
        process.exit(0);
      }
    }

    const bypassEnv = cfg.bypass_env || 'BK_HARNESS_OVERRIDE';

    // Check one-time override
    if (process.env[bypassEnv] === '1') {
      // Log override usage
      try {
        const overrideFile = resolveMetricPath('.bk-metrics/override-log.jsonl');
        appendJsonl(overrideFile, {
          ts: Date.now(),
          tool: toolName,
          override_env: bypassEnv,
          type: 'bypass'
        });
      } catch { /* fail-open */ }

      // Check if halt_override_consumed flag set — one-time use
      const state = readWorkflowState() || {};
      if (state.halt_override_consumed) {
        // Already consumed — block again (fall through)
        process.stderr.write(`[global-kill-switch] Override already consumed. Set ${bypassEnv}=1 again if needed.\n`);
        // Fall through to normal halt check below
      } else {
        // Consume and allow
        try {
          writeWorkflowState({ halt_override_consumed: true });
        } catch { /* fail-open */ }
        process.exit(0);
      }
    }

    // Check current global halt state
    const state = readWorkflowState() || {};

    if (state.global_halt === true) {
      // Already halted — block
      const haltReasons = state.halt_reasons || [];
      const feature = state.feature || 'current';
      const phase = state.current_phase || 'unknown';
      const reason = buildHaltMessage(haltReasons, feature, phase, cfg);

      process.stderr.write(`[global-kill-switch] HALT (existing): ${haltReasons.join(', ')}\n`);
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: reason
        }
      }) + '\n');
      process.exit(2);
    }

    // Count active red signals
    const lookbackMinutes = cfg.lookback_minutes || 30;
    const minSignals = cfg.min_red_signals || 2;
    const { count, types } = countActiveRedSignals(lookbackMinutes);

    if (count >= minSignals) {
      // Trigger global halt
      const feature = state.feature || 'current';
      const phase = state.current_phase || 'unknown';

      try {
        writeWorkflowState({
          global_halt: true,
          halt_ts: Date.now(),
          halt_reasons: types,
          halt_override_consumed: false
        });
      } catch { /* fail-open */ }

      const reason = buildHaltMessage(types, feature, phase, cfg);

      process.stderr.write(`[global-kill-switch] HALT triggered: ${count} red signals (${types.join(', ')})\n`);
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: reason
        }
      }) + '\n');
      process.exit(2);
    }

    // Under threshold — allow
    process.exit(0);
  }

  function buildHaltMessage(sources, feature, phase, cfg) {
    const bypassEnv = cfg.bypass_env || 'BK_HARNESS_OVERRIDE';
    const lookback = cfg.lookback_minutes || 30;
    const minSignals = cfg.min_red_signals || 2;

    return (
      `GLOBAL HARNESS HALT — ${sources.length} red signals active: ${sources.join(', ')}\n\n` +
      `Điều này nghĩa là hệ thống đã phát hiện ≥${minSignals} vấn đề nghiêm trọng cùng lúc.\n` +
      `Tool call bị BLOCK cho tới khi user review.\n\n` +
      `Active red signals (last ${lookback} min): ${sources.join(', ')}\n\n` +
      `Workflow paused at:\n` +
      `  feature: ${feature}\n` +
      `  phase: ${phase}\n\n` +
      `Hãy dùng AskUserQuestion với options:\n` +
      `- "Review full report" → Read .bk-metrics/red-signals.jsonl\n` +
      `- "Resume workflow" → run \`node .claude/cli/bk-health/index.cjs --resume --force\`\n` +
      `- "Abort and commit WIP" → manual git commit with [WIP] prefix\n` +
      `- "Override once (emergency)" → set ${bypassEnv}=1 for 1 call\n\n` +
      `Read-only inspection (Read/Grep/Glob) vẫn được phép để user tìm hiểu.`
    );
  }

  main().catch(() => process.exit(0));
} catch (e) {
  try {
    process.stderr.write(`[global-kill-switch] CRASH (fail-open): ${e.message}\n`);
  } catch { /* ignore */ }
  process.exit(0);
}
