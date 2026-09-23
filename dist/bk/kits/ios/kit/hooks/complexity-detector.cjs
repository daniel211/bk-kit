#!/usr/bin/env node
// complexity-detector.cjs - Auto-detect complexity tier from plan output
// Trigger: SubagentStop (matcher: planner|bk-planner)
// Purpose: Parse plan.md to count sub-tasks, files, estimated LOC
//          then set complexity_tier in .workflow-state.json
// Non-blocking (exit 0). Advisory text is queued for the conductor (lib/conductor-inbox.cjs).

'use strict';

// Outer crash wrapper
try {
  const { createHookTimer } = require('./lib/hook-logger.cjs');
  const fs = require('fs');
  const path = require('path');
  const { resolveProjectRoot } = require('./lib/resolve-project-root.cjs');

  async function main() {
    const timer = createHookTimer('complexity-detector');
    try {
      const { isHookEnabled, readWorkflowState, writeWorkflowState } = require('./lib/bk-config-utils.cjs');

      if (!isHookEnabled('complexity-detector')) {
        timer.end({ status: 'skipped', exit: 0 });
        process.exit(0);
      }

      let input = '';
      for await (const chunk of process.stdin) input += chunk;
      const data = JSON.parse(input || '{}');
      const agentType = (data.agent_type || '').toLowerCase();

      // Only fire for planner agents
      if (!agentType.includes('planner') && !agentType.includes('plan')) {
        timer.end({ status: 'skip_non_planner', exit: 0 });
        process.exit(0);
      }

      // The plan the planner just wrote — the newest plan.md, not the reverse-alphabetical first
      // (see lib/current-plan.cjs for the field case where that picked another feature's plan
      // and wrote its tier into workflow state).
      const { currentPlanFile } = require('./lib/current-plan.cjs');
      const planPath = currentPlanFile(resolveProjectRoot(), readWorkflowState());

      if (!planPath) {
        timer.end({ status: 'no_plan', exit: 0 });
        process.exit(0);
      }

      // Parse plan.md for complexity signals
      const planContent = fs.readFileSync(planPath, 'utf8');
      const lines = planContent.split('\n');

      // Count sub-task files referenced
      const subTaskRefs = (planContent.match(/sub-task-\d+/g) || []);
      const subTaskCount = new Set(subTaskRefs).size;

      // Count files mentioned (common patterns: path/to/file.ext)
      const fileRefs = planContent.match(/(?:^|\s)[\w\-/.]+\.\w{1,5}(?:\s|$|,|\))/gm) || [];
      const uniqueFiles = new Set(fileRefs.map(f => f.trim().replace(/[,)]$/, '')));
      const fileCount = uniqueFiles.size;

      // Count phases/batches
      const phaseCount = (planContent.match(/^#+\s*(phase|batch|step)\s/gim) || []).length;

      // Check for keywords indicating complexity
      const hasNewDeps = /new\s+(dependency|dependencies|package|framework|library)/i.test(planContent);
      const hasCrossCutting = /cross[- ]cutting|refactor|migration|breaking\s+change/i.test(planContent);
      const hasArchChange = /architecture|redesign|restructure/i.test(planContent);

      // Determine tier
      let tier = 'Standard';
      let reason = '';

      if (subTaskCount <= 1 && fileCount <= 2 && !hasNewDeps && !hasCrossCutting) {
        tier = 'Trivial';
        reason = `${subTaskCount} sub-task(s), ${fileCount} file(s), no new deps`;
      } else if (subTaskCount >= 5 || fileCount >= 8 || hasNewDeps || hasCrossCutting || hasArchChange) {
        tier = 'Complex';
        const reasons = [];
        if (subTaskCount >= 5) reasons.push(`${subTaskCount} sub-tasks`);
        if (fileCount >= 8) reasons.push(`${fileCount} files`);
        if (hasNewDeps) reasons.push('new dependencies');
        if (hasCrossCutting) reasons.push('cross-cutting changes');
        if (hasArchChange) reasons.push('architecture changes');
        reason = reasons.join(', ');
      } else {
        reason = `${subTaskCount} sub-task(s), ${fileCount} file(s), ${phaseCount} phase(s)`;
      }

      // Derive suggested_effort_overrides from tier
      const tierLower = tier.toLowerCase();
      let suggested_effort_overrides = {};
      let effort_reason = '';

      if (tierLower === 'complex') {
        suggested_effort_overrides = {
          'bk-planner': 'xhigh',
          'bk-ios-developer': 'xhigh',
          'bk-android-developer': 'xhigh',
          'bk-flutter-developer': 'xhigh',
          'bk-code-reviewer': 'high'
        };
        effort_reason = `complex tier: ${reason}`;
      } else if (tierLower === 'architectural') {
        suggested_effort_overrides = {
          'bk-planner': 'xhigh',
          'bk-ios-developer': 'xhigh',
          'bk-android-developer': 'xhigh',
          'bk-flutter-developer': 'xhigh',
          'bk-code-reviewer': 'xhigh',
          'bk-docs-writer': 'xhigh',
          'bk-git-manager': 'medium',
          'bk-docs-seeker': 'medium'
        };
        effort_reason = `architectural tier: ${reason}`;
      }
      // trivial/standard: empty overrides (use baseline)

      // Write to workflow state
      const state = readWorkflowState() || {};
      const stateUpdate = { complexity_tier: tier, suggested_effort_overrides, effort_reason };
      if (!state.complexity_tier || state.complexity_tier !== tier ||
          JSON.stringify(state.suggested_effort_overrides) !== JSON.stringify(suggested_effort_overrides)) {
        writeWorkflowState(stateUpdate);
      }

      // Inject advisory context
      const output = [
        `[COMPLEXITY-DETECTED] Tier: ${tier}`,
        `Reason: ${reason}`,
        `Sub-tasks: ${subTaskCount} | Files: ${fileCount} | Phases: ${phaseCount}`,
      ];

      if (tier === 'Trivial') {
        output.push('Advisory: Skip review agents. Finalize with bk-git-manager only.');
      } else if (tier === 'Complex') {
        output.push('Advisory: Full review pipeline (code-reviewer + security-auditor + performance-analyzer). Full finalize (3 agents).');
      }

      output.push(`Plan: ${path.relative(resolveProjectRoot(), planPath)}`);

      // Queued for the conductor, not printed: this runs on SubagentStop, whose output only ever
      // reached the planner's own transcript (all 7 field [COMPLEXITY-DETECTED] rows are
      // sidechain). No injection budget here — conductor-inbox-drain applies it on delivery, and
      // charging it twice would make the delivery look like a duplicate of itself.
      const { postToConductor } = require('./lib/conductor-inbox.cjs');
      const queued = postToConductor(resolveProjectRoot(), data.session_id || data.sessionId || null, {
        source: 'complexity-detector',
        text: output.join('\n')
      });

      timer.end({ status: 'ok', tier, subTasks: subTaskCount, files: fileCount, queued, exit: 0 });
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
    try { const {appendJsonl: _ra} = require('./lib/jsonl-rotator.cjs'); _ra(p.join(logDir, 'hook-log.jsonl'), JSON.stringify({ ts: new Date().toISOString(), hook: 'complexity-detector', status: 'crash', error: e.message }) + '\n'); }
    catch(_e2) { fs.appendFileSync(p.join(logDir, 'hook-log.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), hook: 'complexity-detector', status: 'crash', error: e.message }) + '\n'); }
  } catch (_) {}
  process.exit(0); // Fail-open
}
