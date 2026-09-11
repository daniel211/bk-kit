#!/usr/bin/env node
// subagent-iteration-cap.cjs - PreToolUse Task hook.
// Tracks agent dispatch counts and blocks when cap is exceeded.
// Fail-open on crash.

'use strict';

try {
  const fs = require('fs');
  const path = require('path');

  const { loadHarnessPolicy, trackRedSignal, trackViolation } = require('./lib/harness-policy-loader.cjs');
  const { isHookEnabled, readWorkflowState, writeWorkflowState } = require('./lib/bk-config-utils.cjs');
  const { AGENT_DISPATCH_TOOLS } = require('./lib/hook-event-accessor.cjs');

  /**
   * Parse override env: BK_HARNESS_DISPATCH_OVERRIDE=agentType=N
   * Returns the override cap for an agent type, or null if not set.
   */
  function parseOverrideCap(agentType) {
    const envVal = process.env.BK_HARNESS_DISPATCH_OVERRIDE;
    if (!envVal) return null;
    // Format: "agentType=N" or "agentType=+N"
    const parts = envVal.split(',');
    for (const part of parts) {
      const match = part.trim().match(/^(.+?)=\+?(\d+)$/);
      if (match && match[1] === agentType) {
        return parseInt(match[2], 10);
      }
    }
    return null;
  }

  /**
   * Extract subagent type from Task tool input.
   *
   * The name pattern is matched against `description` only, never the prompt. A dispatch
   * prompt routinely mentions other agents ("as bk-code-reviewer noted"), and scanning it
   * would charge the dispatch to whichever agent happened to be named first.
   */
  function extractAgentType(toolInput) {
    if (!toolInput) return null;
    if (toolInput.subagent_type) return toolInput.subagent_type;
    const text = toolInput.description || '';
    if (!text) return null;
    const match = text.match(/\b(bk-[a-z][a-z0-9-]+)/i);
    return match ? match[1] : null;
  }

  /**
   * Which feature this dispatch belongs to.
   *
   * The cap is meant to catch a conductor looping on ONE feature, so the count has to be
   * scoped to one. `state.feature` cannot carry that alone: it exists in the state file but
   * nothing ever writes a value into it, so every dispatch a project ever made shared a
   * single bucket and the counter became a ratchet — agents hit their cap permanently,
   * across features and across sessions, and the block claimed a feature scope it did not
   * have.
   *
   * The identity is in the dispatch itself. Every workflow addresses a feature by path —
   * `bk/dev/{feature-slug}/...` — so the prompt names it even when the state file does not.
   *
   * @param {object} toolInput
   * @param {object} state
   * @returns {string} a feature key; 'unscoped' when nothing identifies one
   */
  function extractFeatureKey(toolInput, state) {
    const text = `${toolInput.prompt || ''}\n${toolInput.description || ''}`;
    // `shared` is the cross-feature scratch directory, not a feature.
    const match = text.match(/\bbk\/(?:dev|specs)\/(?!shared\b)([a-z0-9][a-z0-9._-]*)\//i);
    if (match) return match[1];
    if (state && typeof state.feature === 'string' && state.feature) return state.feature;
    return 'unscoped';
  }

  /**
   * Read counts for one feature, migrating the old flat shape.
   *
   * The previous shape was `{ [agent]: n }` with no feature dimension. Those numbers cannot
   * be attributed to a feature after the fact, and carrying them forward would preserve
   * exactly the ratchet this change exists to remove — a project would stay blocked on a
   * count it accumulated weeks ago. They are dropped; `agent_dispatch_history` keeps the
   * timestamped record.
   *
   * @param {object} state
   * @param {string} featureKey
   * @returns {{counts: object, all: object}}
   */
  function readCounts(state, featureKey) {
    const raw = state.agent_dispatch_count || {};
    const isLegacy = Object.values(raw).some((v) => typeof v === 'number');
    const all = isLegacy ? {} : raw;
    return { counts: { ...(all[featureKey] || {}) }, all };
  }

  async function main() {
    // Read stdin via stream
    let raw = '';
    try {
      for await (const chunk of process.stdin) raw += chunk;
    } catch { process.exit(0); }

    let input = {};
    try { input = JSON.parse(raw || '{}'); } catch { process.exit(0); }

    if (!isHookEnabled('subagent-iteration-cap')) process.exit(0);

    const policy = loadHarnessPolicy();
    const cfg = policy.deadloop.subagent_iteration;
    if (!cfg.enabled) process.exit(0);

    const toolName = input.tool_name || '';

    // Only handle Task tool
    if (!AGENT_DISPATCH_TOOLS.includes(toolName)) process.exit(0);

    const toolInput = input.tool_input || {};
    const agentType = extractAgentType(toolInput);

    if (!agentType) {
      // Can't determine agent type — pass through
      process.exit(0);
    }

    const state = readWorkflowState() || {};
    const featureKey = extractFeatureKey(toolInput, state);
    const { counts } = readCounts(state, featureKey);
    const currentCount = counts[agentType] || 0;

    // Determine cap
    const perAgentCaps = cfg.per_agent_caps || {};
    const defaultCap = cfg.default_cap || 3;
    const policyCap = perAgentCaps[agentType] !== undefined ? perAgentCaps[agentType] : defaultCap;

    // Check override env
    const overrideCap = parseOverrideCap(agentType);
    const effectiveCap = overrideCap !== null ? overrideCap : policyCap;

    if (currentCount >= effectiveCap) {
      // BLOCK
      const history = (state.agent_dispatch_history || []).slice(-10);
      const histTable = history.map(h =>
        `  ${new Date(h.ts).toISOString()} ${h.agent}${h.feature ? ` (${h.feature})` : ''}`
      ).join('\n');

      const scopeNote = featureKey === 'unscoped'
        ? `No feature could be identified from this dispatch, so the count is shared by every\n` +
          `dispatch that also names none. If that is the whole story here, the count may not\n` +
          `reflect a real loop — check the history below before decomposing anything.\n\n`
        : '';

      const reason =
        `AGENT DISPATCH CAP EXCEEDED — "${agentType}" dispatched ${currentCount} times ` +
        `for feature "${featureKey}".\n` +
        `Limit (policy): ${effectiveCap}\n\n` +
        scopeNote +
        `Nếu đây thực sự là vòng lặp, nguyên nhân thường là:\n` +
        `1. Conductor đang retry mù thay vì escalate\n` +
        `2. Approach hiện tại không thể giải, cần breakthrough\n` +
        `3. Feature quá lớn, cần decompose\n\n` +
        `HÀNH ĐỘNG:\n` +
        `- KHÔNG retry cùng agent.\n` +
        `- AskUserQuestion với options:\n` +
        `  • "Decompose feature and restart" — break into sub-features\n` +
        `  • "Escalate to human review" — stop, ask specific question\n` +
        `  • "Reset the count" — node .claude/cli/bk-health/index.cjs --reset-counts ` +
        `--agent ${agentType} --force\n` +
        `  • "Override cap (+5 dispatches)" — set BK_HARNESS_DISPATCH_OVERRIDE=${agentType}=${currentCount + 5}\n\n` +
        `Dispatch history (last 10, all features):\n${histTable || '  (none)'}`;

      process.stderr.write(`[subagent-iteration-cap] BLOCK: ${agentType} at count=${currentCount} (cap=${effectiveCap})\n`);

      trackRedSignal('subagent_cap_exceeded', { agent: agentType, count: currentCount, cap: effectiveCap });
      trackViolation({
        hook: 'subagent-iteration-cap',
        violation_type: 'subagent_cap_exceeded',
        tool: toolName,
        agent: agentType,
        blocked: true,
        severity: 'red',
        context: { count: currentCount, cap: effectiveCap }
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

    // Under cap — increment this feature's count and append to history, both derived from
    // the state read under the write lock. Parallel dispatches of the same agent reach this
    // hook together; counting from `state` read above lets them all write "n + 1" and the cap
    // then never trips.
    try {
      writeWorkflowState((fresh) => {
        // readCounts, not fresh.agent_dispatch_count directly — the legacy flat shape has to
        // be migrated here too, or a write would resurrect the counts it drops.
        const { counts: freshCounts, all: freshAll } = readCounts(fresh, featureKey);
        freshCounts[agentType] = (freshCounts[agentType] || 0) + 1;
        const freshHistory = [
          ...(fresh.agent_dispatch_history || []),
          { ts: Date.now(), agent: agentType, feature: featureKey }
        ].slice(-50);  // keep last 50
        return {
          agent_dispatch_count: { ...freshAll, [featureKey]: freshCounts },
          agent_dispatch_history: freshHistory,
          // Other hooks read state.feature and have only ever seen null. Record what this
          // dispatch identified so they stop guessing too.
          ...(featureKey !== 'unscoped' ? { feature: featureKey } : {})
        };
      });
    } catch { /* fail-open */ }

    process.exit(0);
  }

  main().catch(() => process.exit(0));
} catch (e) {
  try {
    process.stderr.write(`[subagent-iteration-cap] CRASH (fail-open): ${e.message}\n`);
  } catch { /* ignore */ }
  process.exit(0);
}
