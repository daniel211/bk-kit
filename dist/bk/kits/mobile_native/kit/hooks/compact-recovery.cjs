#!/usr/bin/env node
// compact-recovery.cjs - Inject conductor brief after context compaction
// Trigger: SessionStart (matcher: compact)
// Purpose: Restore conductor awareness of role, current state, and rules
// after context compaction wipes all prior instructions.
// Non-blocking (exit 0). Output via stdout injected into Claude context.

'use strict';

// Outer crash wrapper (catches require/parse failures)
try {
  const { createHookTimer } = require('./lib/hook-logger.cjs');
  const fs = require('fs');
  const path = require('path');

  async function main() {
    const timer = createHookTimer('compact-recovery');
    try {
      const { isHookEnabled, readWorkflowState, readLatestCheckpoint } = require('./lib/bk-config-utils.cjs');

      if (!isHookEnabled('compact-recovery')) {
        timer.end({ status: 'skipped', exit: 0 });
        process.exit(0);
      }

      let input = '';
      for await (const chunk of process.stdin) input += chunk;
      const data = JSON.parse(input || '{}');
      const source = data.source || '';

      // Only fire on compact events
      if (source !== 'compact') {
        timer.end({ status: 'not_compact', exit: 0 });
        process.exit(0);
      }

      // Read workflow state (may have been restored by session-init checkpoint)
      const state = readWorkflowState() || {};
      const platform = process.env.BK_PLATFORM || state.platform || 'unknown';
      const activePlan = process.env.BK_ACTIVE_PLAN || '';

      const lines = [];

      // --- Section 1: Role reminder ---
      lines.push('## Post-Compact Recovery');
      lines.push('');
      lines.push('Context was compacted. Re-establishing conductor awareness.');
      lines.push('');
      lines.push('### Your Role');
      lines.push('You are CONDUCTOR. You orchestrate via Task(), you do NOT write code/docs/tests directly.');
      lines.push('Dispatch template: Task(subagent_type, model, prompt with: Task: + Files: + Output: + Constraints:)');
      lines.push('');

      // --- Section 2: Current state ---
      if (state.command || state.current_phase) {
        lines.push('### Current State');
        lines.push(`- Workflow: ${state.command || '?'}`);
        lines.push(`- Phase: ${state.current_phase || '?'}`);
        if (state.feature) lines.push(`- Feature: ${state.feature}`);
        lines.push(`- Platform: ${platform}`);
        if (state.complexity_tier) lines.push(`- Tier: ${state.complexity_tier}`);
        if (state.quality_fix_count) lines.push(`- Fix count: ${state.quality_fix_count}`);
        if (state.skills_loaded && state.skills_loaded.length > 0) {
          lines.push(`- Skills loaded: ${state.skills_loaded.join(', ')}`);
        }

        // Skill chain context
        if (state.chain_history && state.chain_history.length > 0) {
          lines.push(`- Chain: ${state.chain_history.map(h => h.skill).join(' → ')} → current`);
          const lastChain = state.chain_history[state.chain_history.length - 1];
          if (lastChain.output_path) {
            lines.push(`- Previous output: ${lastChain.output_path}`);
          }
        }

        lines.push('');
      }

      // --- Section 3: Active plan ---
      if (activePlan) {
        lines.push(`### Active Plan`);
        lines.push(`Read: ${activePlan}/plan.md`);
        lines.push(`State: ${activePlan}/.plan-state.json`);
        lines.push('');
      }

      // --- Section 4: Key rules summary ---
      lines.push('### Key Rules (abbreviated)');
      lines.push('- After every agent return: check output for stuck/error/low-confidence signals.');
      lines.push('- Reactive: dispatch helper skill (bk-brainstormer / bk-sequential-thinking / bk-problem-solving). Max 2 per signal.');
      lines.push('- Adaptive Finalize: Trivial=git, Standard=pm+git, Complex=pm+docs+git.');
      lines.push('- Fix-loop limits: bk-code max 2, bk-refactor max 1.');
      lines.push('- For full rules: read .claude/rules/conductor-brief.md');
      lines.push('');

      // --- Section 5: Resume instructions ---
      lines.push('### Resume');
      lines.push('1. Read .workflow-state.json for current_phase');
      lines.push('2. Verify artifacts from last completed phase exist');
      lines.push('3. Resume from current_phase — never re-execute completed phases');
      lines.push('4. Do NOT reload already-loaded skills');

      process.stdout.write(lines.join('\n') + '\n');

      timer.end({ status: 'ok', exit: 0 });
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
    try { const {appendJsonl: _ra} = require('./lib/jsonl-rotator.cjs'); _ra(p.join(logDir, 'hook-log.jsonl'), JSON.stringify({ ts: new Date().toISOString(), hook: 'compact-recovery', status: 'crash', error: e.message }) + '\n'); }
    catch(_e2) { fs.appendFileSync(p.join(logDir, 'hook-log.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), hook: 'compact-recovery', status: 'crash', error: e.message }) + '\n'); }
  } catch (_) {}
  process.exit(0); // Fail-open
}
