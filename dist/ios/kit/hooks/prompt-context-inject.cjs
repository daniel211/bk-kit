#!/usr/bin/env node
'use strict';
/**
 * Prompt Context Injection Hook
 * Trigger: UserPromptSubmit
 * Purpose: Inject active plan context + delegation reminders with debounce
 * Non-blocking (exit 0). Output via stdout injected into Claude context.
 *
 * Tiered injection:
 * - T0 (every prompt): workflow state + plan dir (~30 tokens)
 * - T1 (every 4th prompt OR after compact): full reminders (~120 tokens)
 */
try {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  const { resolveProjectRoot } = require('./lib/resolve-project-root.cjs');
  const { loadConfig, buildLanguageSection } = require('./lib/bk-config-utils.cjs');

  const FULL_INJECT_INTERVAL = 4;
  const COUNTER_FILE = path.join(os.tmpdir(), 'bk-prompt-inject-counter.json');

  function readCounter() {
    try {
      if (fs.existsSync(COUNTER_FILE)) {
        const data = JSON.parse(fs.readFileSync(COUNTER_FILE, 'utf8'));
        // Reset counter if stale (>30 min = likely new session)
        if (Date.now() - (data.timestamp || 0) > 1800000) return 0;
        return data.count || 0;
      }
    } catch { /* ignore */ }
    return 0;
  }

  function writeCounter(count) {
    try {
      fs.writeFileSync(COUNTER_FILE, JSON.stringify({ count, timestamp: Date.now() }));
    } catch { /* ignore */ }
  }

  async function main() {
    try {
      const stdin = fs.readFileSync(0, 'utf-8').trim();
      if (!stdin) process.exit(0);

      // Detect compact event from session-init env
      let isPostCompact = false;
      try {
        const data = JSON.parse(stdin);
        isPostCompact = (data.source === 'compact');
      } catch { /* not JSON, ignore */ }

      const promptCount = readCounter();
      const needsFullInject = (promptCount % FULL_INJECT_INTERVAL === 0) || isPostCompact;
      writeCounter(promptCount + 1);

      const lines = [];
      const root = resolveProjectRoot();

      // T0: Locale/language section — always inject when configured
      try {
        const cfg = loadConfig();
        const langLines = buildLanguageSection({
          thinkingLanguage: cfg.locale?.thinkingLanguage,
          responseLanguage: cfg.locale?.responseLanguage
        });
        lines.push(...langLines);
      } catch { /* ignore config errors */ }

      // T0: Always inject — workflow state + plan dir (~30 tokens)
      const statePath = path.join(root, 'bk', 'dev', 'shared', '.workflow-state.json');
      let state = {};
      if (fs.existsSync(statePath)) {
        try {
          state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
          if (state.command && state.current_phase) {
            lines.push(`Workflow: ${state.command} | Phase: ${state.current_phase}${state.feature ? ' | Feature: ' + state.feature : ''}${state.complexity_tier ? ' | Tier: ' + state.complexity_tier : ''}`);
          }
        } catch (e) { /* ignore corrupt state */ }
      }

      const plansDir = path.join(root, 'bk', 'dev');
      if (fs.existsSync(plansDir)) {
        try {
          const dirs = fs.readdirSync(plansDir)
            .filter(d => !d.startsWith('.') && d !== 'shared')
            .sort().reverse();
          if (dirs.length > 0) {
            lines.push(`Plan: bk/dev/${dirs[0]}/`);
          }
        } catch (e) { /* ignore */ }
      }

      // T0.5b: Effort guidance injection — when complexity tier is complex/architectural
      const effortTier = (state.complexity_tier || '').toLowerCase();
      const effortOverrides = state.suggested_effort_overrides || {};
      const effortKeys = Object.keys(effortOverrides);
      if (effortKeys.length > 0 && (effortTier === 'complex' || effortTier === 'architectural')) {
        const overrideLines = effortKeys.map(k => `  ${k}: ${effortOverrides[k]}`).join('\n');
        const effortReason = state.effort_reason || effortTier;
        const block = [
          '',
          `=== EFFORT GUIDANCE (complexity: ${effortTier}) ===`,
          'For Task() spawns in this workflow, use these effort levels:',
          overrideLines,
          `Reason: ${effortReason}`,
          'Override by passing `effort` parameter in Task spec when spawning.',
          '================================================='
        ].join('\n');
        // Cap at ~500 chars
        lines.push(block.substring(0, 500));
      }

      // T0.5: Signal-driven reactive injection (ALWAYS when signals active)
      const signalCount = state.signal_count || 0;
      const lastSignal = state.last_signal || null;
      const retryAgents = state.retry_agents || [];
      if (signalCount >= 2 && lastSignal) {
        const SIGNAL_HELPERS = {
          'agent_stuck': 'bk-brainstormer',
          'fix_loop_stuck': 'bk-problem-solving',
          'confidence_low': 'bk-sequential-thinking',
          'conflicting_results': 'bk-sequential-thinking',
          'unknown_api': 'bk-docs-seeker',
          'architecture_concern': 'bk-brainstormer',
          'performance_issue': 'bk-brainstormer'
        };
        const helper = SIGNAL_HELPERS[lastSignal.type] || 'bk-brainstormer';
        const lastAgent = lastSignal.agent || 'unknown';
        const sameAgentCount = retryAgents.filter(a => a === lastAgent).length;
        lines.push('');
        lines.push(`## ⚠️ REACTIVE REQUIRED (${signalCount} signals)`);
        lines.push(`Last signal: ${lastSignal.type} from ${lastAgent} (${sameAgentCount}x).`);
        lines.push(`MUST dispatch ${helper}. Do NOT retry ${lastAgent}.`);
        if (signalCount >= 3) {
          lines.push('Signal count >= 3: ESCALATE to user if helper also fails.');
        }
      }

      // T1: Full reminders + workflow-specific rules — every Nth prompt or after compact
      if (needsFullInject) {
        lines.push('');
        lines.push('## Reminders');
        lines.push('- CONDUCTOR: orchestrate via Task(), never write code/docs/tests directly.');
        lines.push('- After agent return: check stuck/error/low-confidence → dispatch helper.');
        lines.push('- Finalize: Trivial=git | Standard=pm+git | Complex=pm+docs+git.');

        // Workflow-specific compact rules (replaces always-loaded static rules)
        const statePath2 = path.join(root, 'bk', 'dev', 'shared', '.workflow-state.json');
        try {
          if (fs.existsSync(statePath2)) {
            const ws = JSON.parse(fs.readFileSync(statePath2, 'utf8'));
            const cmd = ws.command || '';
            if (cmd === 'bk-code' || cmd === 'bk-debug' || cmd === 'bk-refactor') {
              lines.push('- FSM: phases must follow state-machine transitions. Max 2 fix-loops before escalate.');
              lines.push('- Traceability: tag commits/tests with the trace IDs from the sub-task reqs: field.');
            }
            if (cmd === 'bk-plan') {
              lines.push('- Plan outputs sub-task files (30-80 LOC each) with test plan + review checklist.');
              lines.push('- Traceability: assign REQ-{N} IDs to requirements.');
            }
            if (cmd === 'bk-code') {
              lines.push('- Batch execution: implement → test → review → fix per batch. No skip.');
            }
          }
        } catch {}
      }

      // T2: Proactive insights — every 8th prompt
      const needsT2 = (promptCount % 8 === 0);
      if (needsT2) {
        // Project profile
        const profilePath = path.join(root, '.bk-project-profile.json');
        if (fs.existsSync(profilePath)) {
          try {
            const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
            lines.push(`Project: ${profile.platform || '?'} | ${profile.architecture || '?'} | ${profile.complexity_estimate || '?'}`);
          } catch {}
        }
        // Metrics insights
        const insightsPath = path.join(root, '.bk-metrics', 'insights.md');
        if (fs.existsSync(insightsPath)) {
          try {
            const insights = fs.readFileSync(insightsPath, 'utf8');
            const topInsight = insights.split('\n').filter(l => l.startsWith('- ')).slice(0, 1).join('');
            if (topInsight) lines.push(`[INSIGHT] ${topInsight.substring(2, 100)}`);
          } catch {}
        }
        // User preferences
        const prefsPath = path.join(root, '.bk-preferences.json');
        if (fs.existsSync(prefsPath)) {
          try {
            const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
            if (prefs.docs_priority) lines.push(`User prefs: docs=${prefs.docs_priority}, approval=${prefs.approval_style || 'gate'}`);
          } catch {}
        }
      }

      if (lines.length > 0) {
        process.stdout.write(lines.join('\n') + '\n');
      }
      process.exit(0);
    } catch (e) {
      process.exit(0);
    }
  }
  main();
} catch (e) {
  process.exit(0);
}
