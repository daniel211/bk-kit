#!/usr/bin/env node
// skill-chain-suggest.cjs.tmpl - Suggest next skill after current skill workflow completes
// Trigger: SubagentStop (catch-all) — fires after ANY agent finishes
// Purpose: Read workflow state, determine next logical skill in chain, output suggestion
// Non-blocking (exit 0).

'use strict';

// Outer crash wrapper
try {
  const { createHookTimer } = require('./lib/hook-logger.cjs');
  const fs = require('fs');
  const path = require('path');
  const { resolveProjectRoot } = require('./lib/resolve-project-root.cjs');

  async function main() {
    const timer = createHookTimer('skill-chain-suggest');
    try {
      const { isHookEnabled, readWorkflowState } = require('./lib/bk-config-utils.cjs');

      if (!isHookEnabled('skill-chain-suggest')) {
        timer.end({ status: 'skipped', exit: 0 });
        process.exit(0);
      }

      // Consume stdin
      let input = '';
      for await (const chunk of process.stdin) input += chunk;
      let hookData = {};
      try { hookData = JSON.parse(input || '{}'); } catch { /* no session → nothing queued */ }

      const state = readWorkflowState() || {};
      const currentSkill = state.command || '';
      const currentPhase = state.current_phase || '';
      const complexityTier = state.complexity_tier || 'Standard';
      const activePlan = state.active_plan || '';

      // Debounce: only suggest once per skill completion
      const lastSuggested = state._last_chain_suggest || '';
      const suggestKey = `${currentSkill}:${currentPhase}`;
      if (lastSuggested === suggestKey) {
        timer.end({ status: 'already_suggested', exit: 0 });
        process.exit(0);
      }

      // Only suggest on terminal phases
      const terminalPhases = ['commit', 'completed', 'approved', 'fixed', 'escalated'];
      if (!currentSkill || !terminalPhases.includes(currentPhase)) {
        timer.end({ status: 'not_terminal', phase: currentPhase, exit: 0 });
        process.exit(0);
      }

      // Detect BRD files in project
      function hasBRD() {
        const root = resolveProjectRoot();
        const checkDirs = [root, path.join(root, 'docs')];
        const brdPatterns = /brd|brief|requirements/i;
        for (const dir of checkDirs) {
          try {
            if (!fs.existsSync(dir)) continue;
            const files = fs.readdirSync(dir);
            if (files.some(f => brdPatterns.test(f))) return true;
          } catch { /* ignore */ }
        }
        return false;
      }

      // Chain map: skill -> next suggestion
      const chainMap = {
        'bk-bootstrap': () => hasBRD() ? '/bk-spec' : '/bk-plan',
        'bk-spec': () => '/bk-plan',
        'bk-plan': () => activePlan
          ? `/bk-autopilot --mode dev-only --plan-path ${activePlan}`
          : '/bk-code',
        'bk-autopilot': () => null, // autopilot handles its own chain
        'bk-code': () => complexityTier === 'Complex' ? '/bk-docs' : null,
        'bk-debug': () => '/bk-test',
        'bk-refactor': () => '/bk-test',
        'bk-test': () => null
      };

      const resolver = chainMap[currentSkill];
      const nextCommand = resolver ? resolver() : null;

      if (!nextCommand) {
        timer.end({ status: 'no_chain', skill: currentSkill, exit: 0 });
        process.exit(0);
      }

      // Build plan path hint for output
      const planHint = activePlan ? activePlan : '';
      const suggestion = `[SUGGEST-NEXT] ${currentSkill} complete (phase: ${currentPhase}). Next: ${nextCommand}${planHint && !nextCommand.includes(planHint) ? ' ' + planHint : ''}`;

      // Mark as suggested to prevent duplicate fires
      try {
        const { writeWorkflowState } = require('./lib/bk-config-utils.cjs');
        writeWorkflowState({ _last_chain_suggest: suggestKey });
      } catch { /* best-effort */ }

      // Queued, not printed: SubagentStop output only ever reached the subagent's own transcript
      // (field: X-Game-Pro agent-a6722278dade32579.jsonl, fusionworkomni
      // agent-abde7f4fe706b884b.jsonl). conductor-inbox-drain delivers it — lib/conductor-inbox.cjs.
      require('./lib/conductor-inbox.cjs').postToConductor(
        require('./lib/resolve-project-root.cjs').resolveProjectRoot(),
        hookData.session_id || hookData.sessionId || null,
        { source: 'skill-chain-suggest', text: suggestion }
      );

      timer.end({ status: 'ok', skill: currentSkill, next: nextCommand, exit: 0 });
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
      JSON.stringify({ ts: new Date().toISOString(), hook: 'skill-chain-suggest', status: 'crash', error: e.message }) + '\n');
  } catch (_) {}
  process.exit(0); // Fail-open
}
