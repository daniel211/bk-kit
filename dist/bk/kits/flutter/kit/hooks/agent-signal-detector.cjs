#!/usr/bin/env node
// agent-signal-detector.cjs - Detect reactive signals in agent output and inject recommendations
// Trigger: PostToolUse (Task)

'use strict';

// Outer crash wrapper (catches require/parse failures)
try {
  const { createHookTimer } = require('./lib/hook-logger.cjs');

  /**
   * Agent Signal Detector Hook
   * Trigger: PostToolCall (Task)
   * Purpose: Detect reactive signals in agent output and inject recommendations
   *
   * Signals detected:
   * - agent_stuck: "cannot determine", "unable to identify", "stuck", "blocked"
   * - unknown_api: "unknown API/framework/method/class"
   * - confidence_low: "confidence: low", confidence percentage < 70%
   * - conflicting_results: "conflicting", "contradicting", "disagree"
   * - architecture_concern: "architecture violation/issue/concern"
   * - performance_issue: "performance critical/severe/bottleneck"
   */

  // Structured signal: agents can emit [SIGNAL: type] for explicit detection
  const STRUCTURED_SIGNAL = /\[SIGNAL:\s*(\w+)\]/i;

  // Tightened patterns (P2-2): broad single-word regexes (e.g. /stuck/, /ambiguous/) caused
  // high false-positive rate — they spam additionalContext and drown out real signals.
  // Strategy:
  //   1. Structured `[SIGNAL: type]` is the primary path (always trusted)
  //   2. Regex fallback requires multi-word context (no single trigger word matches alone)
  //   3. Set BK_SIGNAL_DETECTOR_BROAD=1 to restore old aggressive matching
  const BROAD_MODE = process.env.BK_SIGNAL_DETECTOR_BROAD === '1';
  const SIGNAL_PATTERNS = BROAD_MODE ? [
    // Aggressive (legacy) — opt-in via env
    { pattern: /cannot determine|unable to identify|unclear root cause/i, signal: 'agent_stuck', priority: 'HIGH' },
    { pattern: /stuck|blocked|deadlocked|no progress/i, signal: 'agent_stuck', priority: 'HIGH' },
    { pattern: /not (fully )?confident|uncertain about|ambiguous/i, signal: 'confidence_low', priority: 'HIGH' },
    { pattern: /tried (multiple|several|different) approaches/i, signal: 'agent_stuck', priority: 'HIGH' },
  ] : [
    // Conservative (default) — multi-word/contextual phrases only
    { pattern: /unable to (resolve|fix|complete|implement) (the|this|that)/i, signal: 'agent_stuck', priority: 'HIGH' },
    { pattern: /(cannot|can't) (determine|identify|find) (the|a|any)/i, signal: 'agent_stuck', priority: 'HIGH' },
    { pattern: /no clear path (forward|to proceed)/i, signal: 'agent_stuck', priority: 'HIGH' },
    { pattern: /beyond (my|the) (scope|capability|expertise)/i, signal: 'agent_stuck', priority: 'HIGH' },
    // fix_loop_stuck: error repeating
    { pattern: /same (error|issue|problem) (again|persists|remains|still)/i, signal: 'fix_loop_stuck', priority: 'HIGH' },
    { pattern: /error (persists|not resolved|still occurring|keeps happening)/i, signal: 'fix_loop_stuck', priority: 'HIGH' },
    // unknown_api
    { pattern: /unknown (API|framework|method|class|module|package)/i, signal: 'unknown_api', priority: 'HIGH' },
    // confidence_low — explicit declarations only
    { pattern: /confidence:\s*(low|\d{1,4}[0-6]\d?%)/i, signal: 'confidence_low', priority: 'HIGH' },
    { pattern: /need(s)? (more|additional) (context|information|clarification) to/i, signal: 'confidence_low', priority: 'HIGH' },
    // conflicting_results — explicit "X and Y disagree" framing
    { pattern: /(conflicting|contradicting) (results|findings|recommendations)/i, signal: 'conflicting_results', priority: 'MEDIUM' },
    // architecture_concern
    { pattern: /architecture (violation|concern|mismatch)/i, signal: 'architecture_concern', priority: 'MEDIUM' },
    // performance_issue
    { pattern: /performance (critical|severe|bottleneck|blocking main)/i, signal: 'performance_issue', priority: 'MEDIUM' },
  ];

  const RECOMMENDATIONS = {
    'agent_stuck': 'Dispatch bk-brainstormer with current error context for alternative approach. If brainstormer also fails, dispatch bk-problem-solving. Do NOT retry the same agent.',
    'fix_loop_stuck': 'Fix loop detected — same error repeating. Dispatch bk-problem-solving (Simplification Cascades technique). Do NOT retry — the current approach is fundamentally wrong.',
    'unknown_api': 'Dispatch bk-docs-seeker to look up the unknown API/framework. Include the framework name and error message in dispatch prompt.',
    'confidence_low': 'Agent reports low confidence. Dispatch bk-sequential-thinking for step-by-step analysis. If 2+ agents disagree, AskUserQuestion before proceeding.',
    'conflicting_results': 'Multiple sources/agents disagree. Dispatch bk-sequential-thinking to analyze both sides and recommend.',
    'architecture_concern': 'Architecture issue detected. Dispatch bk-brainstormer for refactor approach evaluation before proceeding.',
    'performance_issue': 'Performance critical issue found. Dispatch bk-brainstormer for optimization approach before proceeding.',
  };

  async function main() {
    const timer = createHookTimer('agent-signal-detector');
    try {
      const { isHookEnabled } = require('./lib/bk-config-utils.cjs');

      if (!isHookEnabled('agent-signal-detector')) {
        timer.end({ status: 'skipped', exit: 0 });
        process.exit(0);
      }

      const { writeWorkflowState } = require('./lib/bk-config-utils.cjs');

      let input = '';
      for await (const chunk of process.stdin) input += chunk;
      const data = JSON.parse(input || '{}');

      const agentOutput = data.tool_result || data.output || data.result || '';
      const toolInput = data.tool_input || {};
      const agentType = toolInput.subagent_type || toolInput.agent_type || 'unknown';

      if (!agentOutput || typeof agentOutput !== 'string') {
        timer.end({ status: 'no_output', exit: 0 });
        process.exit(0);
      }

      const detectedSignals = [];

      // 1. Check structured signals first: [SIGNAL: type]
      let structMatch;
      const structRegex = new RegExp(STRUCTURED_SIGNAL.source, 'gi');
      while ((structMatch = structRegex.exec(agentOutput)) !== null) {
        const sigType = structMatch[1].toLowerCase();
        if (RECOMMENDATIONS[sigType]) {
          detectedSignals.push({ signal: sigType, priority: 'HIGH' });
        }
      }

      // 2. Fallback: regex pattern matching
      for (const { pattern, signal, priority } of SIGNAL_PATTERNS) {
        if (pattern.test(agentOutput)) {
          detectedSignals.push({ signal, priority });
        }
      }

      if (detectedSignals.length > 0) {
        // Deduplicate signals
        const unique = [...new Map(detectedSignals.map(s => [s.signal, s])).values()];

        // Write signal state to workflow-state for downstream hooks. The counter and the
        // agent list accumulate, so they are derived under the write lock — concurrent
        // subagents signalling at once must not overwrite each other's entries.
        try {
          writeWorkflowState((fresh) => ({
            last_signal: {
              type: unique[0].signal,
              priority: unique[0].priority,
              agent: agentType,
              timestamp: Date.now()
            },
            signal_count: (fresh.signal_count || 0) + unique.length,
            // Keep last 10 entries to avoid unbounded growth
            retry_agents: [...(fresh.retry_agents || []), agentType].slice(-10)
          }));
        } catch { /* best-effort state write */ }

        const lines = [];
        for (const { signal, priority } of unique) {
          lines.push(`[REACTIVE-SIGNAL: ${signal}] (${priority})`);
          lines.push(RECOMMENDATIONS[signal]);
        }

        process.stdout.write(JSON.stringify({
          additionalContext: lines.join('\n')
        }) + '\n');

        timer.end({ status: 'signals_detected', count: unique.length, agent: agentType, exit: 0 });
      } else {
        timer.end({ status: 'ok', exit: 0 });
      }

      process.exit(0);
    } catch (err) {
      timer.end({ status: 'error', error: err.message, exit: 0 });
      process.exit(0);
    }
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
    try { const {appendJsonl: _ra} = require('./lib/jsonl-rotator.cjs'); _ra(p.join(logDir, 'hook-log.jsonl'), JSON.stringify({ ts: new Date().toISOString(), hook: 'agent-signal-detector', status: 'crash', error: e.message }) + '\n'); }
    catch(_e2) { fs.appendFileSync(p.join(logDir, 'hook-log.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), hook: 'agent-signal-detector', status: 'crash', error: e.message }) + '\n'); }
  } catch (_) {}
  process.exit(0);
}
