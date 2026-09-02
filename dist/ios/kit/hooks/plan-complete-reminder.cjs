#!/usr/bin/env node
'use strict';
/**
 * Plan Complete Reminder Hook
 * Trigger: SubagentStop (matcher: planner|bk-planner)
 * Purpose: Remind conductor to run /bk-code after planning completes
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

      // Find latest plan directory
      const plansDir = path.join(resolveProjectRoot(), 'mk', 'dev');
      let planPath = null;
      
      if (fs.existsSync(plansDir)) {
        const dirs = fs.readdirSync(plansDir)
          .filter(d => !d.startsWith('.') && d !== 'shared' && fs.existsSync(path.join(plansDir, d, 'plan.md')))
          .sort().reverse();
        if (dirs.length > 0) {
          planPath = path.resolve(plansDir, dirs[0]);
        }
      }

      // Also check workflow state
      if (!planPath) {
        const statePath = path.join(resolveProjectRoot(), 'mk', 'dev', 'shared', '.workflow-state.json');
        if (fs.existsSync(statePath)) {
          try {
            const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
            if (state.plan_dir) planPath = path.resolve(resolveProjectRoot(), state.plan_dir);
          } catch (e) { /* ignore */ }
        }
      }

      if (planPath) {
        const output = [
          '',
          '## Plan Complete',
          `Plan ready at: ${planPath}/plan.md`,
          '',
          `Next step: /bk-code ${planPath}/plan.md`,
          '',
          'Tip: Consider /compact before implementation to free context window.',
          ''
        ].join('\n');
        process.stdout.write(output);
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
