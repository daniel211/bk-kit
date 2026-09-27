#!/usr/bin/env node
'use strict';
/**
 * Prompt Context Injection Hook
 * Trigger: UserPromptSubmit
 * Purpose: Inject active plan context + delegation reminders with debounce
 * Non-blocking (exit 0). Output via stdout injected into Claude context.
 *
 * Tiered injection:
 * - T0: language + workflow state + plan dir + effort guidance + reactive signals — injected
 *   only when it CHANGED since this session last injected it (lib/prompt-inject-state.cjs)
 * - T1 (every 4th user prompt, and the first after start / clear / compact): full reminders
 * - T2 (every 8th user prompt): proactive insights
 *
 * Why "only when changed": in X-Game-Pro (0.12.x, 6 conductor sessions) this hook injected 499
 * times at ~660 chars, almost always the identical T0 block, and every copy stayed in the
 * conductor's history to be re-read on every later request. Most of those prompts were Claude
 * Code's own `<task-notification>` / subagent hand-back turns, which now get nothing at all —
 * and no longer advance the T1/T2 cadence either.
 */
try {
  const fs = require('fs');
  const path = require('path');
  const { resolveProjectRoot } = require('./lib/resolve-project-root.cjs');
  const { loadConfig, buildLanguageSection } = require('./lib/bk-config-utils.cjs');
  const injectState = require('./lib/prompt-inject-state.cjs');
  const { currentPlanDir } = require('./lib/current-plan.cjs');

  const FULL_INJECT_INTERVAL = 4;

  async function main() {
    try {
      const stdin = fs.readFileSync(0, 'utf-8').trim();
      if (!stdin) process.exit(0);

      let data = {};
      try { data = JSON.parse(stdin) || {}; } catch { /* not JSON — treat as a bare prompt */ }

      // Claude Code's own turns (background task notifications, subagent hand-backs) are not
      // the user asking anything, and cannot have changed what this hook would say.
      if (injectState.isAutomatedPrompt(data.prompt)) process.exit(0);

      const root = resolveProjectRoot();
      const sessionId = data.session_id || data.sessionId || null;

      // Per-session cadence and last-injected hash. No session id → no memory: T0 every
      // prompt, as before (fail-open), and no T1/T2 cadence to keep.
      const session = sessionId ? injectState.readPromptInjectState(root, sessionId) : null;
      const promptCount = session ? session.count : 1;
      // count 0 = first user prompt of this session, or the first after /clear or compaction
      // (session-init resets the file on those) — the moment the full reminders belong.
      const needsFullInject = session !== null && promptCount % FULL_INJECT_INTERVAL === 0;

      const lines = [];

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

      // The current workflow's plan, not the reverse-alphabetical first dir under bk/dev/ —
      // that printed `Plan: bk/dev/tracking-background/` next to `Feature: quick-session-create`
      // (lib/current-plan.cjs currentPlanDir has the field case).
      try {
        const planDir = currentPlanDir(root, state);
        if (planDir) lines.push(`Plan: ${planDir}/`);
      } catch { /* ignore */ }

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

      // Everything above is T0. It goes out only when it differs from what this session was
      // last given; T1/T2 below keep their own cadence.
      const t0Text = lines.join('\n');
      const t0Hash = injectState.contentHash(t0Text);
      if (session && session.hash === t0Hash) lines.length = 0;

      // T1: Full reminders + workflow-specific rules — every Nth user prompt, and the first one
      // after start / clear / compact
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
      const needsT2 = session !== null && (promptCount % 8 === 0);
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

      if (sessionId) {
        injectState.writePromptInjectState(root, sessionId, { hash: t0Hash, count: promptCount + 1 });
      }

      // A T1/T2 block after a suppressed T0 must not open with the blank separator line.
      while (lines.length > 0 && lines[0] === '') lines.shift();
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
