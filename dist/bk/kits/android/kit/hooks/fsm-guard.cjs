#!/usr/bin/env node
// fsm-guard.cjs - Validate FSM state transitions for .workflow-state.json writes
// Trigger: PreToolUse (Write|Edit) — fires ONLY when target is .workflow-state.json
// H1-04: Extended with phase-recurrence detection and escalation ladder.

'use strict';

// Outer crash wrapper — fail-closed (guard must block even when broken)
try {
  const { createHookTimer } = require('./lib/hook-logger.cjs');
  const { isHookEnabled, readWorkflowState, writeWorkflowState } = require('./lib/bk-config-utils.cjs');
  const { loadHarnessPolicy, trackRedSignal, trackViolation } = require('./lib/harness-policy-loader.cjs');

  // Built-in transition table per workflow type
  const TRANSITIONS = {
    'bk-code': {
      null: ['plan'],
      plan: ['coding'],
      coding: ['testing'],
      testing: ['review'],
      review: ['coding', 'commit', 'escalated'],
      commit: [],
      aborted: [],
      escalated: ['aborted', 'commit', 'coding']
    },
    'bk-debug': {
      null: ['classify'],
      classify: ['code', 'analyze'],
      analyze: ['brainstorm', 'code'],
      brainstorm: ['code'],
      code: ['test', 'commit'],
      test: ['review', 'commit'],
      review: ['code', 'commit', 'escalated'],
      commit: [],
      aborted: [],
      escalated: ['aborted', 'commit']
    },
    'bk-refactor': {
      null: ['analyze'],
      analyze: ['refactor'],
      refactor: ['test'],
      test: ['refactor', 'commit', 'escalated'],
      commit: [],
      aborted: [],
      escalated: ['aborted', 'commit']
    },
    // /bk-plan never declared itself in the shared state, so a plan run inherited whatever the
    // last workflow left there. In the iOS field repo (X-Game-Pro, 0.10.1) `/bk-plan` for
    // `crypto-module` ran on top of a committed `bk-code:ios-project-init`: the state kept
    // `command: "bk-code"`, `current_phase: "commit"`, the planning agents were traced as a
    // bk-code workflow at commit, and the very first researcher's stop closed a summary as
    // `terminal-entry` with total_agents 1. Planning is now a workflow of its own.
    //
    // `planning` covers the whole plan run — the steps inside it are tracked in
    // .plan-state.json, not here; the FSM only needs to know that a plan is in flight and when
    // it ends. The names are deliberately disjoint from bk-code's (`plan`, `review`, ...): if
    // bk-plan's opening phase were `plan`, a `/bk-code` writing `plan` over it would hit the
    // same-phase fast path and never open its own episode.
    'bk-plan': {
      null: ['planning'],
      planning: ['completed', 'aborted'],
      completed: [],
      aborted: []
    }
  };

  // Workflows whose in-flight state protects nothing. A plan run writes documents under
  // bk/dev/{feature}/ and nothing else, so a plan the user walked away from — approved it in
  // chat without the `completed` write landing, or moved to another feature — must not refuse
  // the next workflow with exit 2. The coding workflows are NOT here: abandoning a bk-code
  // mid-batch leaves half-written source behind, and that refusal is the guard doing its job.
  const ABANDONABLE_WORKFLOWS = new Set(['bk-plan']);

  // Advisory context is subject to the shared injection budget (cap + dedupe). The deny paths
  // below (`permissionDecision: "deny"` + exit 2) deliberately do NOT go through it — a block
  // reason must always reach the model. Optional lib: absent → text goes out unchanged.
  let injectionBudget = null;
  try { injectionBudget = require('./lib/injection-budget.cjs'); } catch { /* optional */ }

  /** @returns {string|null} the text to inject, or null when the budget says stay quiet. */
  function budgetedContext(text, input) {
    if (!injectionBudget) return text;
    try {
      return injectionBudget.prepareInjection('fsm-guard', text, {
        sessionId: injectionBudget.sessionIdFrom(input)
      });
    } catch {
      return text;
    }
  }

  // Phases a workflow ends in. They have no outgoing edges *within* an episode — the only
  // move out of one is starting a new workflow, handled by startsNewEpisode() below.
  // `completed` is bk-plan's: a plan ends at approval, it never commits code.
  const TERMINAL_PHASES = new Set(['commit', 'aborted', 'completed']);

  /**
   * Extract current_phase from JSON content string.
   * Returns null if not found or parse fails.
   * @param {string} content
   * @returns {string|null}
   */
  function extractPhase(content) {
    return extractStringField(content, 'current_phase');
  }

  /**
   * Extract a top-level string field from JSON content, falling back to a regex for the
   * partial content an Edit's new_string carries.
   * @param {string} content
   * @param {string} field
   * @returns {string|null}
   */
  function extractStringField(content, field) {
    if (!content) return null;
    // Try direct JSON parse first
    try {
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed[field] === 'string') return parsed[field];
    } catch { /* not full JSON — try regex */ }
    // Regex fallback for partial content (Edit new_string)
    const match = content.match(new RegExp('"' + field + '"\\s*:\\s*"([^"]+)"'));
    return match ? match[1] : null;
  }

  /**
   * Decide whether a write out of a terminal phase opens a NEW workflow episode.
   *
   * A repo does not get one workflow and then stop: after `/bk-code` lands on `commit`,
   * the next feature has to be able to start. `commit` and `aborted` have no outgoing edges,
   * so without this every workflow after the first is refused with exit 2 and the only way
   * out is deleting the state file by hand.
   *
   * A new episode is either:
   *   (i)  currently in a terminal phase, and the incoming phase is an opening phase
   *        (`TRANSITIONS[type].null`) of the workflow being written; or
   *   (ii) currently in a terminal phase, and the write declares a DIFFERENT feature (or
   *        workflowId) than the one on disk — whatever phase it names.
   *
   * Case (ii) exists because of the iOS field repo: `bk-code:critical-fixes` finished at
   * `commit`, then the next feature's writes kept `current_phase: "commit"` and only changed
   * `feature`/`workflowId`. Those writes matched the `currentPhase === newPhase` fast path and
   * never reached case (i), so no episode ever reset: `phase_history`,
   * `phase_recurrence_count` and `previous_episode` all went on describing `critical-fixes`
   * while the injected plan path had already moved to `security-hardening`. The state file was
   * stuck at a terminal phase forever. This check therefore has to run BEFORE that fast path.
   *
   * Anything else out of a terminal phase stays blocked — resuming the SAME committed feature
   * at `review` is still a bug, not a restart.
   *
   * One exception reaches past terminal phases: (iii) an in-flight ABANDONABLE workflow (a
   * plan) gives way to a write that opens a workflow — a different type, or the same type for
   * a different feature. `/bk-plan` → approve → `/bk-code` is the kit's main path, and a
   * conductor that skips the `completed` write must not be refused at bk-code's first step.
   * Re-writing `planning` for the SAME plan (resume after compaction) is not a new episode.
   *
   * @param {string|null} currentPhase - Phase on disk
   * @param {string} newPhase - Phase being written
   * @param {string|null} startType - Workflow type the new write declares, else the one on disk
   * @param {{current: object, feature: string|null, workflowId: string|null,
   *          workflowType: string|null}} identity - workflowType: the type the write declares
   * @returns {boolean}
   */
  function startsNewEpisode(currentPhase, newPhase, startType, identity) {
    const table = startType && TRANSITIONS[startType];
    const opensWorkflow = Boolean(table && (table.null || []).includes(newPhase));
    if (!currentPhase || !TERMINAL_PHASES.has(currentPhase)) {
      return opensWorkflow && abandonsInFlightPlan(identity);
    }
    if (opensWorkflow) return true;
    return declaresDifferentWorkflow(identity);
  }

  /**
   * Case (iii) of startsNewEpisode: the workflow on disk is abandonable, and the write names
   * a different workflow type or a different feature.
   *
   * @param {{current: object, feature: string|null, workflowId: string|null,
   *          workflowType: string|null}} identity
   * @returns {boolean}
   */
  function abandonsInFlightPlan(identity) {
    if (!identity || !identity.current) return false;
    const onDisk = identity.current.workflow_type || identity.current.command || null;
    if (!onDisk || !ABANDONABLE_WORKFLOWS.has(onDisk)) return false;
    if (identity.workflowType && identity.workflowType !== onDisk) return true;
    return declaresDifferentWorkflow(identity);
  }

  /**
   * Does the incoming write name a different feature/workflowId than the state on disk?
   * A field the write does not declare says nothing — only a declared value that differs
   * counts, so a partial Edit that touches neither field never looks like a new feature.
   *
   * @param {{current: object, feature: string|null, workflowId: string|null}} identity
   * @returns {boolean}
   */
  function declaresDifferentWorkflow(identity) {
    if (!identity || !identity.current) return false;
    const { current, feature, workflowId } = identity;
    if (feature && current.feature && feature !== current.feature) return true;
    if (workflowId && current.workflowId && workflowId !== current.workflowId) return true;
    return false;
  }

  /**
   * Check phase recurrence in recent history (H1-04).
   * Returns action object: { action, message, exitCode }
   */
  function checkPhaseRecurrence(currentState, newPhase, policy) {
    const cfg = policy.deadloop.phase_recurrence;
    if (!cfg || !cfg.enabled) return { action: 'pass' };

    const warnCount = cfg.warn_count || 2;
    const blockCount = cfg.block_count || 3;
    const haltCount = cfg.halt_count || 4;
    const bypassEnv = cfg.bypass_env || 'BK_HARNESS_RECURRENCE_OVERRIDE';

    // Check bypass env
    if (process.env[bypassEnv] === '1') return { action: 'pass' };

    const history = currentState.phase_history || [];
    // Count how many times newPhase appears in last 5 entries + the incoming
    const windowSize = 5;
    const window = history.slice(-windowSize);
    const countInWindow = window.filter(e => e.phase === newPhase).length;
    // +1 for the incoming transition
    const totalCount = countInWindow + 1;

    // Also count total from recurrence map (across all history)
    const recurrenceCount = (currentState.phase_recurrence_count || {})[newPhase] || 0;
    const newRecurrenceCount = recurrenceCount + 1;

    // Counts as one compact line — the pretty-printed dump grew with the workflow and said
    // nothing the phase name and the count did not already say.
    const counts = JSON.stringify(currentState.phase_recurrence_count || {}).slice(0, 120);

    if (totalCount >= haltCount || newRecurrenceCount >= haltCount) {
      return {
        action: 'halt',
        exitCode: 2,
        newRecurrenceCount,
        message:
          `FSM HARD BLOCK — phase "${newPhase}" entered ${newRecurrenceCount} times. Workflow paused. Counts: ${counts}\n` +
          `AskUserQuestion with: resume same approach (resets counter) | abort + escalate (commit WIP) | reset phase, different agent.\n` +
          `Or: node .claude/cli/bk-health/index.cjs --resume --force — Override: ${bypassEnv}=1`
      };
    }

    if (totalCount >= blockCount || newRecurrenceCount >= blockCount) {
      return {
        action: 'block',
        exitCode: 2,
        newRecurrenceCount,
        message:
          `FSM RECURRENCE BLOCK — phase "${newPhase}" entered ${newRecurrenceCount} times (limit: ${blockCount}).\n` +
          `[REACTIVE-SIGNAL: fix_loop_stuck] (HIGH) Task(bk-problem-solving), else bk-brainstormer; ` +
          `AskUserQuestion if both fail. Detail: rules/reactive-orchestration.md §3.\n` +
          `Override: ${bypassEnv}=1`
      };
    }

    if (totalCount >= warnCount || newRecurrenceCount >= warnCount) {
      return {
        action: 'warn',
        exitCode: 0,
        newRecurrenceCount,
        message: `[FSM-RECURRENCE-WARN] Phase "${newPhase}" entered ${newRecurrenceCount} times — expected cycle, or a fix loop?`
      };
    }

    return { action: 'pass', newRecurrenceCount };
  }

  async function main() {
    const timer = createHookTimer('fsm-guard');
    try {
      if (!isHookEnabled('fsm-guard')) {
        timer.end({ status: 'skipped', exit: 0 });
        process.exit(0);
      }

      let raw = '';
      for await (const chunk of process.stdin) raw += chunk;
      const input = JSON.parse(raw || '{}');
      const toolInput = input.tool_input || {};

      // Only guard writes targeting .workflow-state.json
      const targetFile = toolInput.file_path || toolInput.path || '';
      if (!targetFile.endsWith('.workflow-state.json')) {
        timer.end({ status: 'skip_non_target', exit: 0 });
        process.exit(0);
      }

      // Get content being written (Write: content, Edit: new_string)
      const newContent = toolInput.content || toolInput.new_string || '';
      const newPhase = extractPhase(newContent);

      if (!newPhase) {
        // No phase change detected — pass through
        timer.end({ status: 'no_phase_change', exit: 0 });
        process.exit(0);
      }

      // Read current state from disk
      const currentState = readWorkflowState();
      if (!currentState) {
        // No existing state — allow first write
        timer.end({ status: 'no_current_state', exit: 0 });
        process.exit(0);
      }

      const currentPhase = currentState.current_phase || null;
      // Accept either `workflow_type` (canonical) or `command` (schema documented in
      // rules/state-machine.md and the bk-debug/bk-refactor state files).
      const workflowType = currentState.workflow_type || currentState.command || null;
      // The type the incoming write declares. Only consulted for restart detection: a new
      // episode may switch workflows (`bk-code` commits, `bk-debug` starts), and validation
      // of an in-flight workflow still goes by what is on disk.
      const newWorkflowType =
        extractStringField(newContent, 'workflow_type') || extractStringField(newContent, 'command');
      // What the write claims to be working on. A terminal phase plus a different feature is
      // the next workflow starting, even when the phase string has not moved.
      const newFeature = extractStringField(newContent, 'feature');
      const newWorkflowId = extractStringField(newContent, 'workflowId');

      // A finished workflow is not a dead end — starting the next one is allowed, and starts
      // its counters at zero so the previous episode's history cannot halt it.
      // This runs BEFORE the same-phase fast path: a commit→commit write for a NEW feature is
      // exactly the case the field repo got stuck on, and it would be unreachable below.
      const startType =
        (newWorkflowType && TRANSITIONS[newWorkflowType]) ? newWorkflowType : workflowType;
      const identity = {
        current: currentState,
        feature: newFeature,
        workflowId: newWorkflowId,
        workflowType: newWorkflowType
      };
      if (startsNewEpisode(currentPhase, newPhase, startType, identity)) {
        try {
          writeWorkflowState({
            workflow_episode: (currentState.workflow_episode || 1) + 1,
            previous_episode: {
              workflow_type: workflowType,
              feature: currentState.feature || null,
              ended_phase: currentPhase,
              ended_at: currentState.updated_at || null
            },
            // The new episode owns the state now — record what it declares, so the reset does
            // not leave the finished feature's name attached to fresh counters.
            ...(newFeature ? { feature: newFeature } : {}),
            ...(newWorkflowId ? { workflowId: newWorkflowId } : {}),
            phase_history: [{
              phase: newPhase,
              ts: Date.now(),
              entered_by: input.session_id || 'unknown',
              from_phase: currentPhase
            }],
            phase_recurrence_count: { [newPhase]: 1 }
          });
        } catch { /* fail-open on write */ }
        timer.end({ status: 'new_episode', from: currentPhase, to: newPhase, exit: 0 });
        process.exit(0);
      }

      // Ordinary case: same phase, same feature — nothing to validate.
      if (currentPhase === newPhase) {
        timer.end({ status: 'same_phase', exit: 0 });
        process.exit(0);
      }

      // If no workflow type, we can't validate — pass through
      if (!workflowType || !TRANSITIONS[workflowType]) {
        timer.end({ status: 'unknown_workflow', exit: 0 });
        process.exit(0);
      }

      const stateKey = currentPhase === null ? 'null' : currentPhase;
      const allowed = TRANSITIONS[workflowType][stateKey] || [];

      if (!allowed.includes(newPhase)) {
        const openingPhases = ((TRANSITIONS[startType] || {}).null || []).join(', ');
        const restartHint = TERMINAL_PHASES.has(currentPhase)
          ? `"${currentPhase}" is terminal. To start the next workflow, write an opening ` +
            `phase [${openingPhases || 'see the transition table'}] — that opens a new ` +
            `episode with fresh counters.\n`
          : '';
        process.stderr.write(
          `[FSM-GUARD] Invalid transition in ${workflowType}: ` +
          `"${currentPhase}" → "${newPhase}"\n` +
          `Allowed from "${currentPhase}": [${allowed.join(', ') || 'none'}]\n` +
          restartHint
        );
        trackViolation({
          hook: 'fsm-guard',
          violation_type: 'invalid_transition',
          tool: input.tool_name || 'Write',
          target: targetFile,
          blocked: true,
          severity: 'error',
          context: { workflow: workflowType, from: currentPhase, to: newPhase, allowed }
        });
        timer.end({ status: 'blocked', from: currentPhase, to: newPhase, exit: 2 });
        process.exit(2);
      }

      // --- H1-04: Phase recurrence detection ---
      const policy = loadHarnessPolicy();
      const recurrenceResult = checkPhaseRecurrence(currentState, newPhase, policy);

      // Update phase_history and phase_recurrence_count in state
      const phaseHistory = [...(currentState.phase_history || [])];
      phaseHistory.push({
        phase: newPhase,
        ts: Date.now(),
        entered_by: input.session_id || 'unknown',
        from_phase: currentPhase
      });
      // Cap at 50 entries
      const trimmedHistory = phaseHistory.slice(-50);

      const recurrenceCount = { ...(currentState.phase_recurrence_count || {}) };
      recurrenceCount[newPhase] = (recurrenceCount[newPhase] || 0) + 1;

      if (recurrenceResult.action === 'halt') {
        // Write paused state
        try {
          writeWorkflowState({
            phase_history: trimmedHistory,
            phase_recurrence_count: recurrenceCount,
            workflow_paused: true,
            pause_reason: 'phase_recurrence_hard_block',
            pause_ts: Date.now()
          });
        } catch { /* fail-open on write */ }

        trackRedSignal('phase_recurrence_blocked', {
          phase: newPhase,
          count: recurrenceResult.newRecurrenceCount,
          from: currentPhase
        });
        trackViolation({
          hook: 'fsm-guard',
          violation_type: 'phase_recurrence_halt',
          blocked: true,
          severity: 'red',
          context: { phase: newPhase, count: recurrenceResult.newRecurrenceCount }
        });

        process.stderr.write(`[FSM-GUARD] HALT: phase recurrence hard block on "${newPhase}"\n`);
        process.stdout.write(JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: recurrenceResult.message
          }
        }) + '\n');
        timer.end({ status: 'recurrence_halt', phase: newPhase, count: recurrenceResult.newRecurrenceCount, exit: 2 });
        process.exit(2);
      }

      if (recurrenceResult.action === 'block') {
        // Write state but don't set workflow_paused yet
        try {
          writeWorkflowState({
            phase_history: trimmedHistory,
            phase_recurrence_count: recurrenceCount
          });
        } catch { /* fail-open */ }

        trackRedSignal('phase_recurrence_blocked', {
          phase: newPhase,
          count: recurrenceResult.newRecurrenceCount,
          from: currentPhase
        });
        trackViolation({
          hook: 'fsm-guard',
          violation_type: 'phase_recurrence_block',
          blocked: true,
          severity: 'red',
          context: { phase: newPhase, count: recurrenceResult.newRecurrenceCount }
        });

        process.stderr.write(`[FSM-GUARD] BLOCK: phase recurrence on "${newPhase}" (count=${recurrenceResult.newRecurrenceCount})\n`);
        process.stdout.write(JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: recurrenceResult.message
          }
        }) + '\n');
        timer.end({ status: 'recurrence_block', phase: newPhase, count: recurrenceResult.newRecurrenceCount, exit: 2 });
        process.exit(2);
      }

      if (recurrenceResult.action === 'warn') {
        // Update state history and emit advisory
        try {
          writeWorkflowState({
            phase_history: trimmedHistory,
            phase_recurrence_count: recurrenceCount
          });
        } catch { /* fail-open */ }

        process.stderr.write(`[FSM-GUARD] WARN: ${recurrenceResult.message}\n`);
        const warnText = budgetedContext(recurrenceResult.message, input);
        if (warnText) {
          process.stdout.write(JSON.stringify({ additionalContext: warnText }) + '\n');
        }
        timer.end({ status: 'recurrence_warn', phase: newPhase, count: recurrenceResult.newRecurrenceCount, exit: 0 });
        process.exit(0);
      }

      // action === 'pass' — update history silently
      try {
        writeWorkflowState({
          phase_history: trimmedHistory,
          phase_recurrence_count: recurrenceCount
        });
      } catch { /* fail-open */ }

      // Legacy: also check old-style phase_history for fix_loop_stuck signal
      // (keep backward compat with existing logic that used recentPhases)
      const recentPhases = trimmedHistory.slice(-6).map(h => h.phase);
      const currentPhaseCount = recentPhases.filter(p => p === newPhase).length;

      if (currentPhaseCount >= 3 && recurrenceResult.action === 'pass') {
        const signal = `[REACTIVE-SIGNAL: fix_loop_stuck] (HIGH) Phase "${newPhase}" entered ${currentPhaseCount} times — fix loop. ` +
          'Task(bk-problem-solving), else bk-brainstormer; AskUserQuestion if both fail. ' +
          'Detail: rules/reactive-orchestration.md §3.';
        const signalText = budgetedContext(signal, input);
        if (signalText) {
          process.stdout.write(JSON.stringify({ additionalContext: signalText }) + '\n');
        }
        timer.end({ status: 'ok_with_signal', from: currentPhase, to: newPhase, loopCount: currentPhaseCount, exit: 0 });
        process.exit(0);
      }

      timer.end({ status: 'ok', from: currentPhase, to: newPhase, exit: 0 });
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
    try { const {appendJsonl: _ra} = require('./lib/jsonl-rotator.cjs'); _ra(p.join(logDir, 'hook-log.jsonl'), JSON.stringify({ ts: new Date().toISOString(), hook: 'fsm-guard', status: 'crash', error: e.message }) + '\n'); }
    catch(_e2) { fs.appendFileSync(p.join(logDir, 'hook-log.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), hook: 'fsm-guard', status: 'crash', error: e.message }) + '\n'); }
  } catch (_) {}
  // Fail-open on infrastructure errors (require/parse failures).
  // FSM guard blocking only happens inside main() where logic runs.
  process.exit(0);
}
