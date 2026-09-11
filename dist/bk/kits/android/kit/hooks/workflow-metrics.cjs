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
      const agentType = data.agent_type || 'unknown';
      const agentStatus = data.status || 'unknown';

      // Read workflow state
      const state = readWorkflowState() || {};
      const skill = state.command || 'unknown';
      const feature = state.feature || 'unknown';
      const complexityTier = state.complexity_tier || 'Standard';
      const currentPhase = state.current_phase || '';

      // Ensure metrics dir exists
      const metricsDir = path.join(resolveProjectRoot(), '.bk-metrics');
      fs.mkdirSync(metricsDir, { recursive: true });

      // Build trace entry
      const traceEntry = {
        ts: new Date().toISOString(),
        agent: agentType,
        skill,
        feature,
        status: agentStatus,
        complexity_tier: complexityTier
      };

      // Append to agent-trace.jsonl
      const tracePath = path.join(metricsDir, 'agent-trace.jsonl');
      _appendJsonl(tracePath, JSON.stringify(traceEntry) + '\n');

      // Check if skill has completed (summary phase)
      const terminalPhases = ['commit', 'escalated', 'completed'];
      if (terminalPhases.includes(currentPhase)) {
        // Read all trace entries for current feature
        const allLines = fs.existsSync(tracePath)
          ? fs.readFileSync(tracePath, 'utf8').split('\n').filter(Boolean)
          : [];

        const featureEntries = allLines
          .map(l => { try { return JSON.parse(l); } catch { return null; } })
          .filter(e => e && e.feature === feature && e.skill === skill);

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

        const summaryPath = path.join(metricsDir, 'workflow-summary.jsonl');
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
