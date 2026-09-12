#!/usr/bin/env node
// global-kill-switch.cjs - PreToolUse "*" hook (runs FIRST).
// Aggregates red signals and triggers global halt when their weighted sum is exceeded.
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
   * Severity of one red signal type.
   *
   * A type the map does not mention counts 1.0, which is what every type counted before
   * weights existed — so a policy file written against the old schema keeps its behaviour.
   *
   * @param {object} cfg - policy.kill_switch
   * @param {string} type - red signal type
   * @returns {number}
   */
  function weightOf(cfg, type) {
    const w = (cfg.red_signal_weights || {})[type];
    return typeof w === 'number' && isFinite(w) ? w : 1.0;
  }

  /**
   * Render a weight the way the halt message reads best: 1 → "1.0", 0.25 → "0.25".
   * A bare "1" beside "0.25" reads as a count rather than a weight.
   */
  function fmtWeight(n) {
    return Number.isInteger(n) ? n.toFixed(1) : String(Number(n.toFixed(2)));
  }

  /**
   * Distinct active red signal types within the lookback window, plus their weighted sum.
   *
   * Weighting is per distinct TYPE, not per occurrence — five lint runs in a row are one
   * problem, and charging the weight per line would let any repeating signal halt alone.
   * That is the pre-existing distinct-type semantics; only the threshold changed.
   *
   * `ackTs` is a second floor on top of the window. `readRecentRedSignals` lives in the
   * policy loader and only knows about the window, so the ack is applied here: a
   * `--resume` clears `global_halt`, but the signals that caused it are still sitting in
   * red-signals.jsonl and the very next tool call re-read the same 30 minutes and
   * re-halted. Everything logged at or before the ack has been seen by the user.
   *
   * @param {number} lookbackMinutes
   * @param {object} cfg - policy.kill_switch
   * @param {number} ackTs - epoch ms of the last resume, or 0
   * @returns {{count: number, types: string[], weight: number}}
   */
  function countActiveRedSignals(lookbackMinutes, cfg, ackTs) {
    const signals = readRecentRedSignals(lookbackMinutes);
    const uniqueTypes = new Set();
    for (const s of signals) {
      if (!s.type) continue;
      if (ackTs && typeof s.ts === 'number' && s.ts <= ackTs) continue;
      uniqueTypes.add(s.type);
    }
    const types = Array.from(uniqueTypes);
    const weight = types.reduce((sum, t) => sum + weightOf(cfg, t), 0);
    return { count: types.length, types, weight };
  }

  /**
   * The weight at which the harness halts.
   *
   * `min_signal_weight` is the rule — DEFAULT_POLICY always supplies it, so in practice
   * this is the only branch taken. `min_red_signals` survives as the fallback for a policy
   * resolved without the kit's defaults (an old file loaded through BK_HARNESS_POLICY_PATH,
   * say), where every type weighs 1.0 anyway and a count and a weight are the same number.
   *
   * @param {object} cfg - policy.kill_switch
   * @returns {number}
   */
  function haltThreshold(cfg) {
    return typeof cfg.min_signal_weight === 'number'
      ? cfg.min_signal_weight
      : (cfg.min_red_signals || 2);
  }

  /**
   * `subagent_cap_exceeded (1.0) + native_lint_flutter (0.25) = 1.25 / 2.0`
   *
   * Without the breakdown a halt is unarguable: the user sees a list of types and no way
   * to tell which one actually carried it over the line.
   */
  function buildWeightBreakdown(types, cfg) {
    if (!types.length) return `(none) = 0.0 / ${fmtWeight(haltThreshold(cfg))}`;
    const parts = types.map((t) => `${t} (${fmtWeight(weightOf(cfg, t))})`);
    const total = types.reduce((sum, t) => sum + weightOf(cfg, t), 0);
    return `${parts.join(' + ')} = ${fmtWeight(total)} / ${fmtWeight(haltThreshold(cfg))}`;
  }

  function logOverride(toolName, bypassEnv) {
    try {
      const overrideFile = resolveMetricPath('.bk-metrics/override-log.jsonl');
      appendJsonl(overrideFile, {
        ts: Date.now(),
        tool: toolName,
        override_env: bypassEnv,
        type: 'bypass'
      });
    } catch { /* fail-open */ }
  }

  /**
   * Decide whether an override lets this call through.
   *
   * The override used to be one-shot: set the env var, get exactly one tool call, then be
   * blocked again with `halt_override_consumed` set. No real task finishes in one call, so
   * it bought the user nothing. A grant now covers a window, and while the window is open
   * the env var need not still be set — set it once, keep working.
   *
   * `halt_override_consumed` is still written so state files and readers that predate the
   * window keep seeing the field, but it no longer gates anything unless the window is
   * disabled (`override_window_minutes: 0`), which restores the old single-call semantics.
   *
   * @param {object} state - workflow state
   * @param {object} cfg - policy.kill_switch
   * @param {string} bypassEnv
   * @param {string} toolName
   * @returns {boolean} true when this call should be allowed through
   */
  function checkOverrideGrant(state, cfg, bypassEnv, toolName) {
    const windowMinutes = cfg.override_window_minutes;
    const windowed = typeof windowMinutes === 'number' && windowMinutes > 0;
    const now = Date.now();
    const until = typeof state.halt_override_until === 'number' ? state.halt_override_until : 0;

    // An open grant allows on its own — no env var required for the rest of the window.
    if (windowed && now < until) return true;

    if (process.env[bypassEnv] !== '1') {
      // Say so when a grant has just run out: the next call is about to be judged on the
      // signals again, and silence there looks like the override "stopped working".
      if (windowed && until > 0 && now >= until) {
        process.stderr.write(
          `[global-kill-switch] Override window expired at ${new Date(until).toISOString()} — ` +
          `halt checks are active again. Set ${bypassEnv}=1 to grant another ${windowMinutes} min.\n`
        );
      }
      return false;
    }

    logOverride(toolName, bypassEnv);

    if (!windowed) {
      // Legacy single-call behaviour, kept for anyone who configures the window to 0.
      if (state.halt_override_consumed) {
        process.stderr.write(`[global-kill-switch] Override already consumed. Set ${bypassEnv}=1 again if needed.\n`);
        return false;
      }
      try { writeWorkflowState({ halt_override_consumed: true }); } catch { /* fail-open */ }
      return true;
    }

    const grantUntil = now + windowMinutes * 60 * 1000;
    try {
      writeWorkflowState({ halt_override_until: grantUntil, halt_override_consumed: true });
    } catch { /* fail-open */ }
    process.stderr.write(
      `[global-kill-switch] Override granted for ${windowMinutes} min ` +
      `(until ${new Date(grantUntil).toISOString()}).\n`
    );
    return true;
  }

  function denyWithReason(reason) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason
      }
    }) + '\n');
    process.exit(2);
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
    const state = readWorkflowState() || {};

    if (checkOverrideGrant(state, cfg, bypassEnv, toolName)) process.exit(0);

    if (state.global_halt === true) {
      // Already halted — block
      const haltReasons = state.halt_reasons || [];
      const feature = state.feature || 'current';
      const phase = state.current_phase || 'unknown';
      const reason = buildHaltMessage(haltReasons, feature, phase, cfg);

      process.stderr.write(`[global-kill-switch] HALT (existing): ${haltReasons.join(', ')}\n`);
      denyWithReason(reason);
    }

    // Count active red signals — window first, then everything the last resume acknowledged
    const lookbackMinutes = cfg.lookback_minutes || 30;
    const ackTs = typeof state.red_signal_ack_ts === 'number' ? state.red_signal_ack_ts : 0;
    const { count, types, weight } = countActiveRedSignals(lookbackMinutes, cfg, ackTs);

    if (weight >= haltThreshold(cfg)) {
      // Trigger global halt
      const feature = state.feature || 'current';
      const phase = state.current_phase || 'unknown';

      try {
        writeWorkflowState({
          global_halt: true,
          halt_ts: Date.now(),
          halt_reasons: types,
          halt_weight: weight,
          // A new halt episode starts with no override in hand, however the last one ended.
          halt_override_consumed: false,
          halt_override_until: null
        });
      } catch { /* fail-open */ }

      const reason = buildHaltMessage(types, feature, phase, cfg);

      process.stderr.write(
        `[global-kill-switch] HALT triggered: ${buildWeightBreakdown(types, cfg)} ` +
        `(${count} distinct types)\n`
      );
      denyWithReason(reason);
    }

    // Under threshold — allow
    process.exit(0);
  }

  function buildHaltMessage(sources, feature, phase, cfg) {
    const bypassEnv = cfg.bypass_env || 'BK_HARNESS_OVERRIDE';
    const lookback = cfg.lookback_minutes || 30;
    const windowMinutes = cfg.override_window_minutes;
    const overrideNote = typeof windowMinutes === 'number' && windowMinutes > 0
      ? `set ${bypassEnv}=1 for ${windowMinutes} min of work`
      : `set ${bypassEnv}=1 for 1 call`;

    return (
      `GLOBAL HARNESS HALT — weighted red signals over threshold.\n\n` +
      `${buildWeightBreakdown(sources, cfg)}\n\n` +
      `Mỗi loại signal có severity riêng; halt xảy ra khi TỔNG weight vượt ngưỡng.\n` +
      `Tool call bị BLOCK cho tới khi user review.\n\n` +
      `Active red signals (last ${lookback} min): ${sources.join(', ') || 'none'}\n\n` +
      `Workflow paused at:\n` +
      `  feature: ${feature}\n` +
      `  phase: ${phase}\n\n` +
      `Hãy dùng AskUserQuestion với options:\n` +
      `- "Review full report" → Read .bk-metrics/red-signals.jsonl\n` +
      `- "Resume workflow" → run \`node .claude/cli/bk-health/index.cjs --resume --force\`\n` +
      `- "Abort and commit WIP" → manual git commit with [WIP] prefix\n` +
      `- "Override (emergency)" → ${overrideNote}\n\n` +
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
