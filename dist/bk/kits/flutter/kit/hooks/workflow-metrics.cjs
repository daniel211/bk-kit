#!/usr/bin/env node
// workflow-metrics.cjs - Auto-collect metrics after each agent completes
// Trigger: SubagentStop
// Purpose: Record agent trace, aggregate workflow summaries for telemetry
// Non-blocking (exit 0). No stdout context injection (pure data collection).

'use strict';

// Outer crash wrapper
try {
  const { createHookTimer } = require('./lib/hook-logger.cjs');
  const fs = require('fs');
  const path = require('path');
  const { resolveProjectRoot } = require('./lib/resolve-project-root.cjs');

  async function main() {
    const timer = createHookTimer('workflow-metrics');
    try {
      const { isHookEnabled, readWorkflowState } = require('./lib/bk-config-utils.cjs');
      const { appendJsonl: _appendJsonl } = require('./lib/jsonl-rotator.cjs');
      const { emitSummary } = require('./lib/workflow-summary.cjs');
      const { classifyAgentOutput } = require('./lib/agent-signal-patterns.cjs');

      if (!isHookEnabled('workflow-metrics')) {
        timer.end({ status: 'skipped', exit: 0 });
        process.exit(0);
      }

      // Parse stdin
      let input = '';
      for await (const chunk of process.stdin) input += chunk;
      const data = JSON.parse(input || '{}');
      const {
        readStopIdentity, isCompletion, alreadyRecorded, readJsonlRows
      } = require('./lib/subagent-stop-identity.cjs');

      const identity = readStopIdentity(data);
      const agentType = identity.name || '';

      // SubagentStop fires far more often than subagents are dispatched, and only the events
      // that name an agent correspond to one finishing. Tracing the rest as `agent: "unknown"`
      // is what put 680 phantom rows in agent-trace.jsonl out of 792, and total_agents below
      // is just a count of those rows — hence a workflow that dispatched about 16 agents
      // reporting 685, and insights.md calling that healthy.
      if (!isCompletion(identity)) {
        timer.end({ status: 'unattributable_stop', exit: 0 });
        process.exit(0);
      }

      // The agent's status, classified from what it actually said.
      //
      // This read `data.status`, which SubagentStop does not carry: the captured payload shape
      // (.bk-metrics/subagent-stop-payload-keys.json, observed independently in both field
      // repos) has agent_id, agent_transcript_path, agent_type, background_tasks, cwd, effort,
      // hook_event_name, last_assistant_message, permission_mode, prompt_id, scratchpad_dir,
      // session_crons, session_id, stop_hook_active, transcript_path — and no `status`. All 42
      // field trace rows read `status: "unknown"`, so every metric derived from status was a
      // structural zero (see fix_loops in lib/workflow-summary.cjs).
      //
      // `last_assistant_message` is the agent's FINAL message — where a bk agent puts its
      // report or its escalation — not its whole transcript. A signal raised mid-run and then
      // resolved is deliberately not recorded here.
      const finalMessage = typeof data.last_assistant_message === 'string'
        ? data.last_assistant_message
        : '';
      const signals = classifyAgentOutput(finalMessage);
      const agentStatus = signals[0] || (finalMessage.trim() ? 'ok' : 'no_output');

      // Read workflow state
      const state = readWorkflowState() || {};
      const skill = state.command || 'unknown';
      const feature = state.feature || 'unknown';
      const complexityTier = state.complexity_tier || 'Standard';
      const currentPhase = state.current_phase || '';

      // Ensure metrics dir exists
      const metricsDir = path.join(resolveProjectRoot(), '.bk-metrics');
      fs.mkdirSync(metricsDir, { recursive: true });

      const tracePath = path.join(metricsDir, 'agent-trace.jsonl');

      // A completion can be reported twice — the field caught a bk-project-manager run whose
      // second event read a longer transcript than its first. Without this, that run was
      // traced twice and counted twice: 8 traced agents against 7 that actually finished.
      const existingRows = readJsonlRows(tracePath);
      if (alreadyRecorded(existingRows, 'stable_id', identity.id, data.session_id)) {
        timer.end({ status: 'duplicate_stop', exit: 0 });
        process.exit(0);
      }

      // FEATURE-CHANGE ROLLUP — close out the previous (skill, feature) before starting a new
      // one. Work moving to another feature is the last moment its rows can still be attributed
      // to it, and the terminal-phase edge below fires at most once per feature: post-commit.cjs
      // pins current_phase at "commit" and nothing moves it back, so every later stop exits at
      // `already_summarized`. Against the field data this close-out alone recovers
      // critical-security-fixes (8 unsummarized rows), iap-purchase-flow (3),
      // crash-fixes-critical (1) and the 5 orphan "unknown" rows that no summary ever covered.
      //
      // Gated on the session. agent-trace.jsonl is shared by every session in the repo — the
      // kit already assumes concurrent sessions, which is why lib/lint-queue.cjs keys its queue
      // by session id — so two sessions working two features interleave their rows. Without the
      // gate, six alternating stops from two sessions both parked in "commit" produced five
      // summaries, three of them feature-change rollups each reading total_agents 1: exactly the
      // "Avg 1.0 agents/workflow" shape the edge trigger above exists to prevent. A key change
      // within ONE session is a feature genuinely progressing; a key change measured against
      // another session's row is just interleaving, and closes nothing.
      //
      // An unattributable row is not evidence either, so a missing session_id on either side
      // means no rollup.
      //
      // The trade-off, stated plainly: a feature change that spans sessions (session 1 ends on
      // feature A, session 2 opens on B) no longer gets a feature-change rollup for A. Normally
      // the session-stop flush closes A at the end of session 1 — except when session 1 was
      // interrupted, because Stop does not fire on an interrupted turn (measured in
      // fusionworkomni: last Stop 02:31:44, then a 10-minute turn ending in UserPromptSubmit at
      // 02:41:46 with no Stop, leaving 7 files queued and never linted — the same interrupt hole
      // reaches here). A then stays open until some later session works on A and moves off it
      // within that session. Still strictly better than the status quo, where A is never closed.
      const lastRow = existingRows[existingRows.length - 1];
      const sameSession = Boolean(
        lastRow && lastRow.session_id && data.session_id && lastRow.session_id === data.session_id
      );
      if (sameSession && (lastRow.skill !== skill || lastRow.feature !== feature)) {
        emitSummary({
          metricsDir,
          skill: lastRow.skill,
          feature: lastRow.feature,
          phase: lastRow.phase || '',
          complexityTier: lastRow.complexity_tier || 'Standard',
          closedBy: 'feature-change'
        });
      }

      // Build trace entry
      const traceEntry = {
        ts: new Date().toISOString(),
        agent: agentType,
        stable_id: identity.id,
        session_id: data.session_id || null,
        skill,
        feature,
        status: agentStatus,
        signals,
        complexity_tier: complexityTier,
        phase: currentPhase
      };

      _appendJsonl(tracePath, JSON.stringify(traceEntry) + '\n');

      // Check if skill has completed (summary phase)
      const terminalPhases = ['commit', 'escalated', 'completed'];

      /**
       * True only for the FIRST terminal-phase stop after a non-terminal one.
       *
       * The guard below used to ask whether the workflow IS in a terminal phase, not
       * whether it just ENTERED one. In the field current_phase sat at "commit" for over a
       * day (8 literal `commit -> commit` self-transitions), so every SubagentStop while
       * parked there appended another summary: 30 summary rows in one day, each reading
       * total_agents 1, and insights.md concluding "Avg 1.0 agents/workflow" for a period
       * that actually ran 33 agents. That is why the edge trigger survives the close-out
       * work added around it — the fix for under-counting must not resurrect this.
       *
       * The previous trace row for the same feature+skill is the phase we came from. A row
       * with no `phase` at all was written by an older kit version — count it as
       * non-terminal so an upgrade mid-run still yields one summary rather than none.
       * Deliberately does not consult phase_history: the state file is not guaranteed to
       * carry it.
       */
      function justEnteredTerminalPhase() {
        const rows = fs.existsSync(tracePath)
          ? fs.readFileSync(tracePath, 'utf8').split('\n').filter(Boolean)
            .map(l => { try { return JSON.parse(l); } catch { return null; } })
            .filter(e => e && e.feature === feature && e.skill === skill)
          : [];
        // rows[rows.length - 1] is the entry just appended; its predecessor is the prior stop.
        const prev = rows[rows.length - 2];
        if (!prev) return true;
        return !terminalPhases.includes(prev.phase);
      }

      if (terminalPhases.includes(currentPhase) && !justEnteredTerminalPhase()) {
        timer.end({ status: 'already_summarized', agent: agentType, skill, feature, exit: 0 });
        process.exit(0);
      }

      if (terminalPhases.includes(currentPhase)) {
        emitSummary({
          metricsDir, skill, feature,
          phase: currentPhase,
          complexityTier,
          closedBy: 'terminal-entry'
        });
      }

      timer.end({ status: 'ok', agent: agentType, skill, feature, exit: 0 });
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
    fs.appendFileSync(p.join(logDir, 'hook-log.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), hook: 'workflow-metrics', status: 'crash', error: e.message }) + '\n');
  } catch (_) {}
  process.exit(0); // Fail-open
}
