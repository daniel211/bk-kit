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
   * Looks at description or prompt for recognized agent names.
   */
  function extractAgentType(toolInput) {
    if (!toolInput) return null;
    // Direct subagent_type field
    if (toolInput.subagent_type) return toolInput.subagent_type;
    // Check description for agent name pattern
    const text = toolInput.description || toolInput.prompt || '';
    if (!text) return null;
    // Match bk-xxx-agent or bk-xxx patterns
    const match = text.match(/\b(bk-[a-z][a-z0-9-]+)/i);
    return match ? match[1] : null;
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
    if (toolName !== 'Task') process.exit(0);

    const toolInput = input.tool_input || {};
    const agentType = extractAgentType(toolInput);

    if (!agentType) {
      // Can't determine agent type — pass through
      process.exit(0);
    }

    const state = readWorkflowState() || {};
    const dispatchCounts = state.agent_dispatch_count || {};
    const currentCount = dispatchCounts[agentType] || 0;

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
        `  ${new Date(h.ts).toISOString()} ${h.agent}`
      ).join('\n');

      const reason =
        `AGENT DISPATCH CAP EXCEEDED — "${agentType}" dispatched ${currentCount} times ` +
        `for feature "${state.feature || 'current'}".\n` +
        `Limit (policy): ${effectiveCap}\n\n` +
        `Điều này CỰC KỲ BẤT THƯỜNG. Có thể do:\n` +
        `1. Conductor đang retry mù thay vì escalate\n` +
        `2. Approach hiện tại không thể giải, cần breakthrough\n` +
        `3. Feature quá lớn, cần decompose\n\n` +
        `HÀNH ĐỘNG:\n` +
        `- KHÔNG retry cùng agent.\n` +
        `- AskUserQuestion với options:\n` +
        `  • "Decompose feature and restart" — break into sub-features\n` +
        `  • "Escalate to human review" — stop, ask specific question\n` +
        `  • "Override cap (+5 dispatches)" — set BK_HARNESS_DISPATCH_OVERRIDE=${agentType}=${currentCount + 5}\n\n` +
        `Dispatch history (last 10):\n${histTable || '  (none)'}`;

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

    // Under cap — increment count
    dispatchCounts[agentType] = currentCount + 1;

    // Append to history
    const history = state.agent_dispatch_history || [];
    history.push({ ts: Date.now(), agent: agentType });
    // Keep last 50
    const trimmedHistory = history.slice(-50);

    try {
      writeWorkflowState({
        agent_dispatch_count: dispatchCounts,
        agent_dispatch_history: trimmedHistory
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
