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
      const { isHookEnabled, readWorkflowState, writeWorkflowState } = require('./lib/bk-config-utils.cjs');
      const { appendJsonl: _appendJsonl } = require('./lib/jsonl-rotator.cjs');

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
      const agentStatus = data.status || 'unknown';

      // SubagentStop fires far more often than subagents are dispatched, and only the events
      // that name an agent correspond to one finishing. Tracing the rest as `agent: "unknown"`
      // is what put 680 phantom rows in agent-trace.jsonl out of 792, and total_agents below
      // is just a count of those rows — hence a workflow that dispatched about 16 agents
      // reporting 685, and insights.md calling that healthy.
      if (!isCompletion(identity)) {
        timer.end({ status: 'unattributable_stop', exit: 0 });
        process.exit(0);
      }

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
      if (alreadyRecorded(readJsonlRows(tracePath), 'stable_id', identity.id, data.session_id)) {
        timer.end({ status: 'duplicate_stop', exit: 0 });
        process.exit(0);
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
        complexity_tier: complexityTier
      };

      _appendJsonl(tracePath, JSON.stringify(traceEntry) + '\n');

      // Check if skill has completed (summary phase)
      const terminalPhases = ['commit', 'escalated', 'completed'];
      if (terminalPhases.includes(currentPhase)) {
        // Agents dispatched for THIS workflow — those traced since the previous summary for
        // the same feature and skill.
        //
        // It used to count every trace row the feature had ever produced, so the number grew
        // by one per workflow and was reported as that workflow's own. Six commits on one
        // feature filed total_agents 101, 102, 103, 104, 105, 106, and insights.md read that
        // back as "Avg 103.5 agents/workflow" for a feature that dispatched about 8. The
        // absurdity was invisible while phantom rows had it reporting 685.
        const summaryPath = path.join(metricsDir, 'workflow-summary.jsonl');
        const priorSummaries = fs.existsSync(summaryPath)
          ? fs.readFileSync(summaryPath, 'utf8').split('\n').filter(Boolean)
            .map(l => { try { return JSON.parse(l); } catch { return null; } })
            .filter(e => e && e.feature === feature && e.skill === skill && e.ts)
          : [];
        const since = priorSummaries.length
          ? Date.parse(priorSummaries[priorSummaries.length - 1].ts)
          : 0;

        const allLines = fs.existsSync(tracePath)
          ? fs.readFileSync(tracePath, 'utf8').split('\n').filter(Boolean)
          : [];

        const featureEntries = allLines
          .map(l => { try { return JSON.parse(l); } catch { return null; } })
          .filter(e => e && e.feature === feature && e.skill === skill)
          .filter(e => !since || (Date.parse(e.ts) || 0) > since);

        const totalAgents = featureEntries.length;
        const fixLoops = featureEntries.filter(e =>
          (e.agent || '').toLowerCase().includes('fix') ||
          (e.status || '').toLowerCase().includes('fix_loop')
        ).length;
        const reactiveSignals = featureEntries.filter(e =>
          (e.agent || '').toLowerCase().includes('brainstorm') ||
          (e.agent || '').toLowerCase().includes('problem-solving') ||
          (e.agent || '').toLowerCase().includes('sequential-thinking')
        ).length;

        // Estimate duration (approximate: count agents * avg 120s)
        const totalDurationEst = totalAgents * 120;

        const summary = {
          ts: new Date().toISOString(),
          skill,
          feature,
          phase: currentPhase,
          complexity_tier: complexityTier,
          total_agents: totalAgents,
          total_duration_est: totalDurationEst,
          fix_loops: fixLoops,
          reactive_signals: reactiveSignals
        };

        _appendJsonl(summaryPath, JSON.stringify(summary) + '\n');

        // Serena sync (optional - only if BK_SERENA_AVAILABLE=true)
        if (process.env.BK_SERENA_AVAILABLE === 'true') {
          // Write flag file — actual Serena write_memory happens in conductor context, not hook
          const serenaSyncPath = path.join(metricsDir, 'serena-sync-pending.json');
          const syncPayload = {
            ts: new Date().toISOString(),
            skill,
            feature,
            summary_ref: summaryPath,
            pending: true
          };
          fs.writeFileSync(serenaSyncPath, JSON.stringify(syncPayload, null, 2), 'utf8');
        }
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
