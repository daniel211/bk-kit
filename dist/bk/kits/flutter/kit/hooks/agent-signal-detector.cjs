#!/usr/bin/env node
// agent-signal-detector.cjs - Detect reactive signals in agent output and inject recommendations
// Trigger: SubagentStop (completions only — see lib/subagent-stop-identity.cjs)
//
// Until 0.10.1 this ran on PostToolUse(Task|Agent) and read `data.tool_result || data.output ||
// data.result`. PostToolUse carries none of those — its field is `tool_response` — so the hook
// logged `no_output` on 100% of its runs in both field repos and `reactive_signals` was a
// structural zero everywhere. Reading `tool_response` instead would not have helped for long:
// Claude Code now dispatches agents in the background by default, and for those PostToolUse
// fires at launch with "Async agent launched successfully…", before the agent has said
// anything. SubagentStop fires at completion and carries `last_assistant_message`, the agent's
// final message — the same text workflow-metrics classifies with the same vocabulary. When the
// agent ended with a SubagentHandback tool call (Claude Code 2.1.285+) that field is "" and the
// message is read from the agent transcript instead: lib/subagent-final-message.cjs.
//
// Delivery: SubagentStop output never reaches the conductor, so the recommendation is queued in
// lib/conductor-inbox.cjs and delivered by conductor-inbox-drain.cjs on the conductor's next
// event, where the injection budget is applied.

'use strict';

// Outer crash wrapper (catches require/parse failures)
try {
  const { createHookTimer } = require('./lib/hook-logger.cjs');

  /**
   * Agent Signal Detector Hook
   * Trigger: SubagentStop
   * Purpose: Detect reactive signals in a finished agent's final message and inject recommendations
   *
   * Signals detected:
   * - agent_stuck: "cannot determine", "unable to identify", "stuck", "blocked"
   * - unknown_api: "unknown API/framework/method/class"
   * - confidence_low: "confidence: low", confidence percentage < 70%
   * - conflicting_results: "conflicting", "contradicting", "disagree"
   * - architecture_concern: "architecture violation/issue/concern"
   * - performance_issue: "performance critical/severe/bottleneck"
   */

  // The signal vocabulary itself lives in lib/agent-signal-patterns.cjs so SubagentStop can
  // apply the same rules to an agent's final message. See that file for why: `data.status`
  // does not exist on SubagentStop, so workflow-metrics had no way to classify a finished
  // agent and filed all 42 field trace rows as "unknown".
  const {
    STRUCTURED_SIGNAL, signalPatternsFor
  } = require('./lib/agent-signal-patterns.cjs');

  // Tightened patterns (P2-2): broad single-word regexes (e.g. /stuck/, /ambiguous/) caused
  // high false-positive rate — they spam additionalContext and drown out real signals.
  // Strategy:
  //   1. Structured `[SIGNAL: type]` is the primary path (always trusted)
  //   2. Regex fallback requires multi-word context (no single trigger word matches alone)
  //   3. Set BK_SIGNAL_DETECTOR_BROAD=1 to restore old aggressive matching
  const BROAD_MODE = process.env.BK_SIGNAL_DETECTOR_BROAD === '1';
  const SIGNAL_PATTERNS = signalPatternsFor(BROAD_MODE);

  // One line per signal, naming the agent to dispatch and nothing else. The reasoning behind
  // each route lives in rules/reactive-orchestration.md §3, which the model can read when it
  // needs it — repeating it in every injection cost ~6 KB per Task batch.
  const RECOMMENDATIONS = {
    'agent_stuck': 'Task(bk-brainstormer) with the error context; if that fails, bk-problem-solving. Do NOT retry the same agent.',
    'fix_loop_stuck': 'Same error repeating: Task(bk-problem-solving). Do NOT retry — the approach itself is wrong.',
    'unknown_api': 'Task(bk-docs-seeker) with the framework name + error text.',
    'confidence_low': 'Task(bk-sequential-thinking). If 2+ agents disagree, AskUserQuestion first.',
    'conflicting_results': 'Task(bk-sequential-thinking) to weigh both sides and pick one.',
    'architecture_concern': 'Task(bk-brainstormer) to evaluate the refactor before proceeding.',
    'performance_issue': 'Task(bk-brainstormer) for an optimisation approach before proceeding.',
  };

  /** At most this many signals are reported — the rest are noise behind the first few. */
  const MAX_REPORTED_SIGNALS = 3;


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

      // A settings.json still wiring this hook to PostToolUse must not act on launch metadata.
      if (data.hook_event_name && data.hook_event_name !== 'SubagentStop') {
        timer.end({ status: 'not_subagent_stop', exit: 0 });
        process.exit(0);
      }

      // Most SubagentStop events are not an agent finishing; only those naming one are.
      const { readStopIdentity, isCompletion } = require('./lib/subagent-stop-identity.cjs');
      const identity = readStopIdentity(data);
      if (!isCompletion(identity)) {
        timer.end({ status: 'not_a_completion', exit: 0 });
        process.exit(0);
      }
      const agentType = identity.name;

      // The FINAL message only, as in workflow-metrics: a signal raised mid-run and then
      // resolved is not a reason to reroute.
      let agentOutput = typeof data.last_assistant_message === 'string'
        ? data.last_assistant_message
        : '';
      // Optional lib: a missing file must not crash the hook — keep the payload field.
      try {
        agentOutput = require('./lib/subagent-final-message.cjs').resolveFinalMessage(data);
      } catch { /* payload field only */ }

      if (!agentOutput.trim()) {
        timer.end({ status: 'no_output', agent: agentType, exit: 0 });
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
        //
        // A completion can be reported twice (lib/subagent-stop-identity.cjs), and counting it
        // twice would double signal_count and list the agent twice in retry_agents. The stable
        // ids already counted are kept alongside, and the check runs inside the same locked
        // updater so two copies of one stop arriving together cannot both pass it.
        let duplicate = false;
        try {
          writeWorkflowState((fresh) => {
            const seen = Array.isArray(fresh.signal_stops) ? fresh.signal_stops : [];
            if (identity.id && seen.includes(identity.id)) {
              duplicate = true;
              return null;   // no write
            }
            return {
              last_signal: {
                type: unique[0].signal,
                priority: unique[0].priority,
                agent: agentType,
                timestamp: Date.now()
              },
              signal_count: (fresh.signal_count || 0) + unique.length,
              // Keep last 10 entries to avoid unbounded growth
              retry_agents: [...(fresh.retry_agents || []), agentType].slice(-10),
              signal_stops: identity.id ? [...seen, identity.id].slice(-20) : seen
            };
          });
        } catch { /* best-effort state write */ }

        if (duplicate) {
          timer.end({ status: 'duplicate_stop', agent: agentType, exit: 0 });
          process.exit(0);
        }

        // HIGH first, then at most MAX_REPORTED_SIGNALS — one line each.
        const reported = [...unique]
          .sort((a, b) => (a.priority === b.priority ? 0 : a.priority === 'HIGH' ? -1 : 1))
          .slice(0, MAX_REPORTED_SIGNALS);

        const lines = reported.map(
          ({ signal, priority }) => `[REACTIVE-SIGNAL: ${signal}] (${priority}) ${RECOMMENDATIONS[signal]}`
        );
        if (unique.length > reported.length) {
          lines.push(`(+${unique.length - reported.length} more signal(s))`);
        }
        lines.push('Detail: rules/reactive-orchestration.md §3.');

        const { resolveProjectRoot } = require('./lib/resolve-project-root.cjs');
        const { postToConductor } = require('./lib/conductor-inbox.cjs');
        const queued = postToConductor(resolveProjectRoot(), data.session_id || data.sessionId || null, {
          source: 'agent-signal-detector',
          text: lines.join('\n')
        });

        timer.end({ status: 'signals_detected', count: unique.length, agent: agentType, queued, exit: 0 });
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
