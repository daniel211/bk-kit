#!/usr/bin/env node
'use strict';
/**
 * Plan Complete Reminder Hook
 * Trigger: SubagentStop (matcher: planner|bk-planner)
 * Purpose: Remind conductor to run /bk-code after planning completes
 * Delivery: queued in the conductor inbox — SubagentStop output never reaches the conductor
 */
try {
  const fs = require('fs');
  const path = require('path');
  const { resolveProjectRoot } = require('./lib/resolve-project-root.cjs');

  async function main() {
    try {
      const stdin = fs.readFileSync(0, 'utf-8').trim();
      if (!stdin) process.exit(0);

      const data = JSON.parse(stdin);
      const agentType = (data.agent_type || '').toLowerCase();
      
      // Only fire for planner agents
      if (!agentType.includes('planner') && !agentType.includes('plan')) {
        process.exit(0);
      }

      // The plan the planner just wrote: the newest plan.md. This used to take the
      // reverse-alphabetical first plan directory, which named another feature's plan in the field
      // (see lib/current-plan.cjs).
      const root = resolveProjectRoot();
      let state = null;
      try {
        state = JSON.parse(fs.readFileSync(path.join(root, 'bk', 'dev', 'shared', '.workflow-state.json'), 'utf8'));
      } catch (e) { /* no workflow state */ }
      const { currentPlanFile } = require('./lib/current-plan.cjs');
      const planFile = currentPlanFile(root, state);

      if (planFile) {
        // "Next step: /bk-code" is wrong advice when the planner ran inside /bk-code's own plan
        // phase — the X-Game-Pro planner at 08:53Z did, and the conductor was told to start the
        // workflow it was already running.
        const insideCode = state && state.command === 'bk-code';
        const output = [
          '## Plan Complete',
          `Plan ready at: ${planFile}`,
          insideCode
            ? 'Next step: continue the running /bk-code workflow with this plan.'
            : `Next step: /bk-code ${planFile}`,
          'Tip: Consider /compact before implementation to free context window.'
        ].join('\n');

        // Queued for the conductor, not printed: SubagentStop output only reaches the planner's
        // own transcript (lib/conductor-inbox.cjs).
        require('./lib/conductor-inbox.cjs').postToConductor(root, data.session_id || data.sessionId || null, {
          source: 'plan-complete-reminder',
          text: output
        });
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
