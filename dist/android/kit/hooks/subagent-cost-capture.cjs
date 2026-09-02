#!/usr/bin/env node
// subagent-cost-capture.cjs - Capture cost for each subagent on SubagentStop
// Trigger: SubagentStop
// Purpose: Parse subagent JSONL transcript → compute cost → append to cost ledger → update workflow state
//
// NOTE: GH #4500 — the broken event is not used here.
// JSONL usage.input_tokens is placeholder 0/1 — effort multiplier compensates ±15-30%.

'use strict';

try {
  const fs = require('fs');
  const { createHookTimer } = require('./lib/hook-logger.cjs');
  // P1-7: migrated from deprecated jsonl-token-parser → token-accurate-parser.
  // Note: parseTranscriptAccurate returns tokensIn as TOTAL (cache + raw); see RC-1 plan.
  const { parseTranscriptAccurate } = require('./lib/token-accurate-parser.cjs');
  const { computeCost, appendEntry } = require('./lib/cost-ledger-writer.cjs');

  async function main() {
    const timer = createHookTimer('subagent-cost-capture');
    try {
      const { isHookEnabled, readWorkflowState, writeWorkflowState } = require('./lib/bk-config-utils.cjs');

      if (!isHookEnabled('subagent-cost-capture')) {
        timer.end({ status: 'skipped', exit: 0 });
        process.exit(0);
      }

      // Read stdin JSON from Claude Code runtime
      // Use fd 0 instead of '/dev/stdin' — fd 0 works with both shell pipes
      // and Node child-process pipes; '/dev/stdin' fails with ENXIO on the latter.
      let hookData = {};
      try {
        const raw = fs.readFileSync(0, 'utf8');
        if (raw && raw.trim()) hookData = JSON.parse(raw);
      } catch { /* no stdin or not JSON — continue */ }

      const transcriptPath = hookData.transcript_path || hookData.transcriptPath || null;
      const sessionId = hookData.session_id || hookData.sessionId || null;
      const agentName = hookData.agent_name || hookData.agentName || hookData.subagent_name || 'unknown';

      if (!transcriptPath) {
        process.stderr.write('[subagent-cost-capture] warn: no transcript_path in hook data — skipping\n');
        timer.end({ status: 'no-transcript', exit: 0 });
        process.exit(0);
      }

      // Parse transcript with 500ms timeout
      const parsed = await parseTranscriptAccurate(transcriptPath, { timeoutMs: 500 });

      // Read workflow state for effort + workflowId
      const state = readWorkflowState() || {};
      const workflowId = state.workflowId || state.workflow_id || sessionId || null;
      const effort = state.effort || state.current_effort || 'medium';
      const model = parsed.model || state.model || 'claude-sonnet-4-6';

      // P1-7 transitional: derive raw input from total to avoid overcharge.
      // parseTranscriptAccurate's tokensIn = cacheRead + cacheCreation + raw.
      // computeCost(model, tokensIn, ...) treats input as raw — pass raw only here.
      // Proper cache-aware pricing lands in P1-4 (cost-ledger-writer refactor).
      const rawInputTokens = Math.max(0,
        parsed.tokensIn - (parsed.cacheReadTokens || 0) - (parsed.cacheCreationTokens || 0));
      const costUsd = computeCost(model, rawInputTokens, parsed.tokensOut, effort);

      // Build ledger entry (no prompt content — numbers/metadata only)
      const entry = {
        type: 'subagent',
        workflowId,
        agent: agentName,
        model,
        effort,
        tokensIn: parsed.tokensIn,
        tokensOut: parsed.tokensOut,
        rawInputTokens,
        cacheReadTokens: parsed.cacheReadTokens || 0,
        cacheCreationTokens: parsed.cacheCreationTokens || 0,
        thinkingTokens: parsed.thinkingTokens || 0,
        costUsd: Math.round(costUsd * 1e8) / 1e8,
        multiplierApplied: getPricingMultiplier(effort),
        source: 'jsonl',
        accuracy: parsed.accuracy,
        sessionId: sessionId || null
      };

      appendEntry(entry);

      // Update cumulative cost in workflow state
      const prevCumulative = state.cumulativeCostUsd || 0;
      const newCumulative = Math.round((prevCumulative + costUsd) * 1e8) / 1e8;
      writeWorkflowState({ cumulativeCostUsd: newCumulative });

      // P1-1: Release any parallel-safety locks owned by this agent.
      // Symmetric pair to acquisition in parallel-safety (PreToolUse Task).
      // Skip when agentName is 'unknown' — would mass-release locks not owned by this hook invocation.
      // TTL fallback (10min) covers the unknown-agent case.
      if (agentName && agentName !== 'unknown') {
        try {
          const { releaseLocksForAgent } = require('./lib/parallel-lock-registry.cjs');
          releaseLocksForAgent(agentName);
        } catch { /* fail-open — TTL will catch leftovers */ }
      }

      timer.end({ status: 'ok', costUsd: entry.costUsd, accuracy: parsed.accuracy, exit: 0 });
      process.exit(0);
    } catch (err) {
      timer.end({ status: 'error', error: err.message, exit: 0 });
      process.exit(0);
    }
  }

  /** Get effort multiplier value for ledger metadata */
  function getPricingMultiplier(effort) {
    try {
      const { computeCost: cc } = require('./lib/cost-ledger-writer.cjs');
      // Derive multiplier by comparing base cost vs effort cost for 1k/1k tokens
      // (avoids importing pricing JSON directly here)
      const base = cc('claude-sonnet-4-6', 1000, 1000, 'medium');
      const withEffort = cc('claude-sonnet-4-6', 1000, 1000, effort);
      return base > 0 ? Math.round((withEffort / base) * 10) / 10 : 1.0;
    } catch { return 1.0; }
  }

  main();
} catch (e) {
  try {
    const fs = require('fs');
    const p = require('path');
    const logDir = p.join(__dirname, '.logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    try { const {appendJsonl: _ra} = require('./lib/jsonl-rotator.cjs'); _ra(p.join(logDir, 'hook-log.jsonl'), JSON.stringify({ ts: new Date().toISOString(), hook: 'subagent-cost-capture', status: 'crash', error: e.message }) + '\n'); }
    catch(_e2) { fs.appendFileSync(p.join(logDir, 'hook-log.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), hook: 'subagent-cost-capture', status: 'crash', error: e.message }) + '\n'); }
  } catch (_) {}
  process.exit(0);
}
