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
  const { parseTranscriptAccurate, isOwnSessionTranscript } = require('./lib/token-accurate-parser.cjs');
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

      const sessionId = hookData.session_id || hookData.sessionId || null;

      const {
        readStopIdentity, isCompletion, alreadyRecorded, readJsonlRows
      } = require('./lib/subagent-stop-identity.cjs');
      const identity = readStopIdentity(hookData);
      const agentName = identity.name || 'unknown';

      // This hook had no gate at all: it billed every SubagentStop, and most of them are not
      // a subagent finishing. In one field run that was 46 entries of `agent: "unknown"`,
      // $0.00, against 8 real ones — and one real subagent billed twice, because its
      // completion was reported twice with a longer transcript the second time.
      if (!isCompletion(identity)) {
        timer.end({ status: 'unattributable_stop', exit: 0 });
        process.exit(0);
      }

      // `agent_transcript_path` is this subagent's own transcript — the file the usage figures
      // were always meant to come from. It sits at `<session>/subagents/agent-*.jsonl` and
      // carries that agent's turns with real per-turn usage; a sample run showed 23 usage
      // records, 198k cache-read tokens, on haiku. Without it the hook fell back to
      // `transcript_path`, which is the session's, and the guard below then correctly refused
      // to attribute it — so every one of the 165 field ledger entries came out at $0.00 and
      // the statusline reported a cumulative cost of zero for three days of work.
      const transcriptPath = hookData.agent_transcript_path || hookData.agentTranscriptPath
        || hookData.transcript_path || hookData.transcriptPath || null;

      if (!transcriptPath) {
        process.stderr.write('[subagent-cost-capture] warn: no transcript_path in hook data — skipping\n');
        timer.end({ status: 'no-transcript', exit: 0 });
        process.exit(0);
      }

      // SubagentStop hands over the session's own transcript, which holds session-wide
      // totals and no subagent turns. Charging those totals to each subagent multiplied
      // the ledger by the number of subagents — one live run recorded 57.8M input tokens
      // against a session that actually used 1.45M. No entry is better than a wrong one.
      if (isOwnSessionTranscript(transcriptPath, sessionId)) {
        process.stderr.write(
          '[subagent-cost-capture] session transcript supplied — per-subagent usage is not '
          + 'attributable, skipping ledger entry\n',
        );
        timer.end({ status: 'unattributed', exit: 0 });
        process.exit(0);
      }

      // Never bill the same subagent twice. Checked before the parse, since a repeat costs
      // nothing to detect and a transcript read is the expensive part of this hook.
      const { resolveMetricsDir: _metricsDir } = require('./lib/cost-ledger-writer.cjs');
      const ledgerPath = require('path').join(_metricsDir(), 'cost-ledger.jsonl');
      if (alreadyRecorded(readJsonlRows(ledgerPath).filter((r) => r.type === 'subagent'),
        'stableId', identity.id, sessionId)) {
        timer.end({ status: 'duplicate_stop', exit: 0 });
        process.exit(0);
      }

      // Parse transcript with 500ms timeout
      const parsed = await parseTranscriptAccurate(transcriptPath, { timeoutMs: 500 });

      // Read workflow state for effort + workflowId
      // Same attribution rule as workflow-metrics: a terminal state left by an earlier session
      // is not this session's workflow, so its cost must not land on that feature's ledger key.
      const { liveStateFor } = require('./lib/stale-workflow-state.cjs');
      const state = liveStateFor(readWorkflowState() || {}, sessionId) || {};
      // The ledger key must be the one budget-guard derives when it reads back, or the
      // filter there matches nothing and every entry ever written gets charged to the
      // current workflow. Both sides go through resolveWorkflowId for that reason.
      const {
        resolveWorkflowId, ownedCumulativeCost, COST_OWNER_KEY
      } = require('./lib/workflow-identity.cjs');
      const workflowId = resolveWorkflowId(state, sessionId);
      // NOTE: nothing in the kit writes state.effort / state.current_effort (SubagentStop input
      // carries no effort either), so this is always 'medium' — a label, not the real level.
      // Harmless to cost now that exact usage skips the multiplier; fixing it needs a writer.
      const effort = state.effort || state.current_effort || 'medium';
      const model = parsed.model || state.model || 'claude-sonnet-4-6';

      // parseTranscriptAccurate's tokensIn is the TOTAL — cacheRead + cacheCreation + raw — so
      // the legacy `computeCost(model, tokensIn, ...)` shape, which treats its input argument as
      // raw, would overcharge wildly. The transitional workaround was to pass raw only, which
      // fixed the overcharge by charging nothing at all for cache, and cache is nearly the
      // entire bill: a field run's three subagents read 17.5M, 11.7M and 9.9M cached tokens
      // against 210, 156 and 166 raw ones. The ledger billed $0.10 for what actually cost about
      // $19.70 — a ~190x undercount, and the first numbers anyone saw after subagent entries
      // started being written at all.
      //
      // computeCost's granular shape prices cache properly (read 0.1x input, creation 1.25x).
      const rawInputTokens = Math.max(0,
        parsed.tokensIn - (parsed.cacheReadTokens || 0) - (parsed.cacheCreationTokens || 0));
      const exact = parsed.accuracy === 'high';
      const costUsd = computeCost({
        model,
        rawInputTokens,
        tokensOut: parsed.tokensOut,
        cacheReadTokens: parsed.cacheReadTokens || 0,
        cacheCreationTokens: parsed.cacheCreationTokens || 0,
        thinkingTokens: parsed.thinkingTokens || 0,
        effort,
        // accuracy 'high' = summed from real per-turn usage rows (exact); 'approx'/'low' are
        // text-length estimates and keep the effort multiplier.
        exactUsage: exact
      });

      // Build ledger entry (no prompt content — numbers/metadata only)
      const entry = {
        type: 'subagent',
        workflowId,
        agent: agentName,
        stableId: identity.id,
        model,
        effort,
        tokensIn: parsed.tokensIn,
        tokensOut: parsed.tokensOut,
        rawInputTokens,
        cacheReadTokens: parsed.cacheReadTokens || 0,
        cacheCreationTokens: parsed.cacheCreationTokens || 0,
        thinkingTokens: parsed.thinkingTokens || 0,
        costUsd: Math.round(costUsd * 1e8) / 1e8,
        multiplierApplied: exact ? 1 : getPricingMultiplier(effort),
        source: 'jsonl',
        accuracy: parsed.accuracy,
        sessionId: sessionId || null
      };

      appendEntry(entry);

      // Update cumulative cost in workflow state. Accumulate from the state read under the
      // write lock, not from `state` read at the top of this hook: parallel subagents all
      // reach SubagentStop at once, and adding to a stale total silently drops the cost of
      // every agent but the last — which budget-guard then spends.
      // Nothing ever reset cumulativeCostUsd, so it was a lifetime total: one field repo
      // reached $17.94 and budget-guard then refused every dispatch forever. The tally is
      // now scoped to a workflow and starts over when the workflow changes. The id is
      // recomputed from `fresh` inside the lock so the comparison and the reset are atomic.
      //
      // The comparison is against the tally's own owner key, not `workflowId`. The conductor
      // writes `workflowId` itself when it starts a feature, so comparing against that meant
      // the ids already matched when the first subagent of a new feature stopped, and the
      // previous features' spend carried over: X-Game-Pro held $441.07 against a workflow
      // whose own ledger rows summed to ~$18. A state with no owner key (anything written
      // before this) resets too — its figure cannot be attributed to any workflow.
      writeWorkflowState((fresh) => {
        const live = liveStateFor(fresh, sessionId) || {};
        const freshId = resolveWorkflowId(live, sessionId);
        const owned = ownedCumulativeCost(live, freshId);
        const total = owned === null ? costUsd : owned + costUsd;
        return {
          workflowId: freshId,
          [COST_OWNER_KEY]: freshId,
          cumulativeCostUsd: Math.round(total * 1e8) / 1e8
        };
      });

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

  /** Multiplier applied to a non-exact row (exact rows record 1 at the call site). */
  function getPricingMultiplier(effort) {
    try {
      return require('./lib/cost-ledger-writer.cjs').effortMultiplier(effort);
    } catch { return 1.0; }
  }

  main();
} catch (e) {
  // A DispatchExit is this hook's own process.exit() unwinding under bk-dispatch, not a
  // crash. Logging it here is how a clean run got filed as `status: "crash"`.
  if (e && e.bkDispatchExit) throw e;

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
