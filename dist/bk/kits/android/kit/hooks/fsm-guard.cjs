#!/usr/bin/env node
// fsm-guard.cjs - Validate FSM state transitions for .workflow-state.json writes
// Trigger: PreToolUse (Write|Edit) — validates; fires ONLY when target is .workflow-state.json
//          PostToolUse (Write|Edit) — applies the bookkeeping PreToolUse decided on
// H1-04: Extended with phase-recurrence detection and escalation ladder.
//
// PreToolUse must never modify the state file when it lets the tool run. It used to write
// phase_history / phase_recurrence_count / the new-episode reset right there — between the
// conductor's Read and its Write of the same file — and Claude Code rejects such a Write with
// "File content has changed since it was last read". In X-Game-Pro (0.10.1) the new-episode
// reset kept `current_phase: "commit"` while changing `feature`, so each retry was again a new
// episode, again mutated the file, and was again rejected: the conductor gave up and ran a whole
// feature at `commit` with the previous feature's plan_dir and batch. Allowed writes now stash
// their bookkeeping (lib/fsm-pending-bookkeeping.cjs) and the PostToolUse mode merges it onto
// the file as the tool left it. Of the deny paths only the recurrence HARD BLOCK writes in
// PreToolUse (the pause flag — the tool never runs); a refused transition is never recorded as
// history (see the recurrence deny paths below).
//
// Hook-owned bookkeeping — phase_history, phase_recurrence_count, recurrence_reset_ts — is
// written by this hook only. A conductor Write/Edit that rewrites it is refused
// (lib/workflow-state-bookkeeping-guard.cjs); the recurrence window is counted from the last
// reset (lib/phase-recurrence-window.cjs).

'use strict';

// Outer crash wrapper — fail-closed (guard must block even when broken)
try {
  const { createHookTimer } = require('./lib/hook-logger.cjs');
  const {
    isHookEnabled, readWorkflowState, writeWorkflowState, workflowStatePath
  } = require('./lib/bk-config-utils.cjs');
  const { pendingKey, stashPending, takePending } = require('./lib/fsm-pending-bookkeeping.cjs');
  const { loadHarnessPolicy, trackRedSignal, trackViolation } = require('./lib/harness-policy-loader.cjs');
  const { countedHistory, windowEntryCount, recurrenceResetFields } = require('./lib/phase-recurrence-window.cjs');
  const {
    proposedState, reviewBookkeepingWrite, bookkeepingDenyMessage
  } = require('./lib/workflow-state-bookkeeping-guard.cjs');
  const fs = require('fs');

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
   *
   * Two numbers decide: the recurrence count (+1 for the incoming transition) and how often
   * the phase appears in the recent history window (+1). Both are counted from the last reset
   * only — the window through lib/phase-recurrence-window.cjs — so a batch boundary or a
   * `bk-health` remedy clears the whole decision, not half of it. The message reports the
   * larger of the two, which is the one that decided; it used to print the count while the
   * window decided, and read "entered 1 times" on a HARD BLOCK.
   *
   * @returns {{action: string, exitCode?: number, entered?: number, message?: string}}
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

    const windowCount = windowEntryCount(currentState, newPhase);
    const countCount = ((currentState.phase_recurrence_count || {})[newPhase] || 0) + 1;
    const entered = Math.max(windowCount, countCount);

    // Counts as one compact line — the pretty-printed dump grew with the workflow and said
    // nothing the phase name and the count did not already say.
    const counts = JSON.stringify(currentState.phase_recurrence_count || {}).slice(0, 120);
    const basis = `(since the last batch/reset: count ${countCount}, recent history ${windowCount})`;
    const cli = 'node .claude/cli/bk-health/index.cjs';
    // The env override is read by the hook process, which inherits the env of the running
    // Claude Code CLI — exporting it from a Bash tool call changes nothing. In X-Game-Pro
    // (0.12.2) that was one more printed remedy that could not work in the session at hand.
    const override =
      `Override: ${bypassEnv}=1 only takes effect in a NEW Claude Code session started with it.`;
    // Said on both deny paths: the field conductor hand-edited phase_history to get past the
    // ladder, and read each of its own refused retries as more history.
    const notRecorded =
      'This transition was refused and NOT recorded — retrying it does not add history. ' +
      'Do not edit phase_history / phase_recurrence_count to get past it; fsm-guard refuses those writes.';

    if (entered >= haltCount) {
      return {
        action: 'halt',
        exitCode: 2,
        entered,
        message:
          `FSM HARD BLOCK — phase "${newPhase}" entered ${entered} times ${basis}. Workflow paused. Counts: ${counts}\n` +
          `${notRecorded}\n` +
          `AskUserQuestion with: resume same approach | resume with a different agent/approach | ` +
          `stop here (WIP stays uncommitted; "escalated" can be written from review).\n` +
          `Either resume needs the user to run: ${cli} --resume --force — clears the pause and ` +
          `resets phase_recurrence_count and the recurrence history window.\n` +
          override
      };
    }

    if (entered >= blockCount) {
      return {
        action: 'block',
        exitCode: 2,
        entered,
        message:
          `FSM RECURRENCE BLOCK — phase "${newPhase}" entered ${entered} times (limit: ${blockCount}) ${basis}.\n` +
          `[REACTIVE-SIGNAL: fix_loop_stuck] (HIGH) Task(bk-problem-solving), else bk-brainstormer; ` +
          `AskUserQuestion if both fail. Detail: rules/reactive-orchestration.md §3.\n` +
          `${notRecorded}\n` +
          `If the user decides to continue: ${cli} --reset-counts --force — resets ` +
          `phase_recurrence_count and the recurrence history window.\n` +
          override
      };
    }

    if (entered >= warnCount) {
      return {
        action: 'warn',
        exitCode: 0,
        entered,
        message: `[FSM-RECURRENCE-WARN] Phase "${newPhase}" entered ${entered} times ${basis} — expected cycle, or a fix loop?`
      };
    }

    return { action: 'pass', entered };
  }

  /**
   * Review a write's hook-owned fields (lib/workflow-state-bookkeeping-guard.cjs).
   * Returns null when the write's resulting document cannot be known — then there is
   * nothing to judge and the write goes through as it always did.
   *
   * @param {object} toolInput
   * @param {object} currentState - state on disk
   * @returns {{deny: string|null, countsReset: boolean, batchAdvanced: boolean,
   *            restore: object, after: object}|null}
   */
  function reviewStateWrite(toolInput, currentState) {
    let rawDisk = null;
    try { rawDisk = fs.readFileSync(workflowStatePath(), 'utf8'); } catch { /* Edit → no judge */ }
    const after = proposedState(toolInput, rawDisk);
    if (!after) return null;
    return { ...reviewBookkeepingWrite(currentState, after), after };
  }

  /**
   * Which half of the guard this event is. The event name is authoritative; a payload without
   * one (older runtimes, hand-driven tests) is PostToolUse only if it carries the tool's result.
   * @param {object} input
   * @returns {boolean}
   */
  function isPostToolUse(input) {
    if (typeof input.hook_event_name === 'string' && input.hook_event_name) {
      return input.hook_event_name === 'PostToolUse';
    }
    return input.tool_response !== undefined;
  }

  /**
   * Record the bookkeeping an allowed write earns, for the PostToolUse half to apply once the
   * tool has written. Nothing here touches .workflow-state.json — see the header for why.
   *
   * `patch` holds ABSOLUTE values computed from the state on disk now, not deltas. A full-file
   * Write carries whatever `phase_history` the conductor copied from its Read (or none at all);
   * the guard's own record is what must survive, so a Write can neither erase the recurrence
   * ladder nor leave a finished feature's history attached to a new episode.
   *
   * @param {object} input - The PreToolUse event
   * @param {'new_episode'|'transition'|'bookkeeping'|'batch_reset'} kind
   * @param {string} phase - The phase the write enters; PostToolUse checks the file agrees
   * @param {object} patch - Fields to merge after the write
   */
  function deferBookkeeping(input, kind, phase, patch) {
    try {
      stashPending(workflowStatePath(), pendingKey(input), { kind, phase, patch });
    } catch { /* fail-open: a lost history entry never blocks a transition */ }
  }

  /**
   * PostToolUse half: merge the stashed bookkeeping onto the file as the tool left it.
   *
   * Only the guard's own fields are in the patch (workflow_episode, previous_episode,
   * phase_history, phase_recurrence_count, recurrence_reset_ts), so everything the write set — current_phase,
   * feature, plan_dir, batch, ... — stays exactly as written, while a history the Write copied
   * from the previous episode is overwritten by the reset.
   *
   * @param {object} input - The PostToolUse event
   * @returns {string} status for the hook log
   */
  function applyPendingBookkeeping(input) {
    const record = takePending(workflowStatePath(), pendingKey(input));
    if (!record || !record.patch) return 'no_pending';
    let status = 'applied_' + record.kind;
    writeWorkflowState((fresh) => {
      // The record describes entering `record.phase`. If the file is not in that phase the
      // write did something the PreToolUse reading did not foresee (an Edit whose new_string
      // matched a phase string that is not the top-level one); recording it would be a lie.
      if (record.phase && fresh.current_phase !== record.phase) {
        status = 'phase_mismatch';
        return null;
      }
      // A batch-boundary stamp starts the history window afresh. It is only true if the count
      // reset it goes with actually landed; otherwise stamping it would clear half the ladder.
      if (record.kind === 'batch_reset') {
        const counts = fresh.phase_recurrence_count;
        if (counts && typeof counts === 'object' && Object.keys(counts).length > 0) {
          status = 'batch_reset_not_landed';
          const { recurrence_reset_ts: _dropped, ...rest } = record.patch;
          return Object.keys(rest).length > 0 ? rest : null;
        }
      }
      return record.patch;
    });
    return status;
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

      // The tool has written: apply what PreToolUse decided, then stop — validation is over.
      if (isPostToolUse(input)) {
        const status = applyPendingBookkeeping(input);
        timer.end({ status: 'post_' + status, exit: 0 });
        process.exit(0);
      }

      // Get content being written (Write: content, Edit: new_string)
      const newContent = toolInput.content || toolInput.new_string || '';
      const newPhase = extractPhase(newContent);

      // Read current state from disk
      const currentState = readWorkflowState();
      if (!currentState) {
        // No existing state — allow first write
        timer.end({ status: newPhase ? 'no_current_state' : 'no_phase_change', exit: 0 });
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
      if (newPhase && startsNewEpisode(currentPhase, newPhase, startType, identity)) {
        // Deferred to PostToolUse. `feature` / `workflowId` are not in the patch: the write
        // itself declares them (that is how this branch was reached), so they land with it.
        deferBookkeeping(input, 'new_episode', newPhase, {
          workflow_episode: (currentState.workflow_episode || 1) + 1,
          previous_episode: {
            workflow_type: workflowType,
            feature: currentState.feature || null,
            ended_phase: currentPhase,
            ended_at: currentState.updated_at || null
          },
          phase_history: [{
            phase: newPhase,
            ts: Date.now(),
            entered_by: input.session_id || 'unknown',
            from_phase: currentPhase
          }],
          phase_recurrence_count: { [newPhase]: 1 },
          // A fresh history needs no window start; this also drops one a Write carried over.
          recurrence_reset_ts: null
        });
        timer.end({ status: 'new_episode', from: currentPhase, to: newPhase, exit: 0 });
        process.exit(0);
      }

      // --- Hook-owned bookkeeping is the hook's (lib/workflow-state-bookkeeping-guard.cjs) ---
      // Runs on every write that is not a new episode, including Edits that name no phase at
      // all: the field conductor's fabricated history came in exactly that way.
      const review = reviewStateWrite(toolInput, currentState);
      if (review && review.deny) {
        trackViolation({
          hook: 'fsm-guard',
          violation_type: 'bookkeeping_tamper',
          tool: input.tool_name || 'Write',
          target: targetFile,
          blocked: true,
          severity: 'error',
          context: { field: review.deny, phase: currentPhase }
        });
        process.stderr.write(`[FSM-GUARD] BLOCK: write rewrites hook-owned "${review.deny}"\n`);
        process.stdout.write(JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: bookkeepingDenyMessage(review.deny)
          }
        }) + '\n');
        timer.end({ status: 'bookkeeping_tamper', field: review.deny, exit: 2 });
        process.exit(2);
      }

      // The state the ladder judges: the one on disk, with this write's count reset applied
      // first. A reset that comes with batch progress also starts the history window afresh
      // (recurrence_reset_ts) — that is the batch boundary the skill defines. A reset WITHOUT
      // batch progress clears the count only, so the window still catches a fix loop that
      // tries to reset its way out.
      let effectiveState = currentState;
      const extraPatch = review ? { ...review.restore } : {};
      if (review && review.countsReset) {
        const resetFields = review.batchAdvanced
          ? recurrenceResetFields()
          : { phase_recurrence_count: {} };
        effectiveState = { ...currentState, ...resetFields };
        delete extraPatch.phase_recurrence_count;
        if (resetFields.recurrence_reset_ts) extraPatch.recurrence_reset_ts = resetFields.recurrence_reset_ts;
      }

      // Not a transition — nothing to validate. Restore what the write dropped and stamp a
      // batch-boundary reset, after the write lands.
      if (!newPhase || currentPhase === newPhase) {
        if (Object.keys(extraPatch).length > 0) {
          const kind = review.countsReset && review.batchAdvanced ? 'batch_reset' : 'bookkeeping';
          deferBookkeeping(input, kind, review.after.current_phase || null, extraPatch);
        }
        timer.end({ status: newPhase ? 'same_phase' : 'no_phase_change', exit: 0 });
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
      const recurrenceResult = checkPhaseRecurrence(effectiveState, newPhase, policy);

      // A refused transition never happened, so it is not history. Both deny paths used to
      // append the attempt to phase_history and bump its count, so every retry of a blocked
      // write made the next decision worse: in X-Game-Pro (0.12.2) three retries of
      // coding→testing turned a block into a HARD BLOCK and left `testing, testing, testing`
      // in the history of a workflow still sitting at `coding`, and the conductor reported
      // "each time I edit this file fsm-guard adds a new testing entry". The red signal and the
      // violation are still logged per attempt — those are what a repeated attempt is — and
      // repeated denials do not climb the ladder on their own.
      if (recurrenceResult.action === 'halt') {
        // Only the pause is written. Writing in PreToolUse is safe on the deny paths only: the
        // tool never runs, so there is no Read→Write pair for this write to invalidate.
        try {
          writeWorkflowState({
            workflow_paused: true,
            pause_reason: 'phase_recurrence_hard_block',
            pause_ts: Date.now()
          });
        } catch { /* fail-open on write */ }

        trackRedSignal('phase_recurrence_blocked', {
          phase: newPhase,
          count: recurrenceResult.entered,
          from: currentPhase
        });
        trackViolation({
          hook: 'fsm-guard',
          violation_type: 'phase_recurrence_halt',
          blocked: true,
          severity: 'red',
          context: { phase: newPhase, count: recurrenceResult.entered }
        });

        process.stderr.write(`[FSM-GUARD] HALT: phase recurrence hard block on "${newPhase}"\n`);
        process.stdout.write(JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: recurrenceResult.message
          }
        }) + '\n');
        timer.end({ status: 'recurrence_halt', phase: newPhase, count: recurrenceResult.entered, exit: 2 });
        process.exit(2);
      }

      if (recurrenceResult.action === 'block') {
        // Nothing is written — see above.
        trackRedSignal('phase_recurrence_blocked', {
          phase: newPhase,
          count: recurrenceResult.entered,
          from: currentPhase
        });
        trackViolation({
          hook: 'fsm-guard',
          violation_type: 'phase_recurrence_block',
          blocked: true,
          severity: 'red',
          context: { phase: newPhase, count: recurrenceResult.entered }
        });

        process.stderr.write(`[FSM-GUARD] BLOCK: phase recurrence on "${newPhase}" (count=${recurrenceResult.entered})\n`);
        process.stdout.write(JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: recurrenceResult.message
          }
        }) + '\n');
        timer.end({ status: 'recurrence_block', phase: newPhase, count: recurrenceResult.entered, exit: 2 });
        process.exit(2);
      }

      // Allowed: the transition is recorded — in PostToolUse, after the write lands.
      const phaseHistory = [...(effectiveState.phase_history || [])];
      phaseHistory.push({
        phase: newPhase,
        ts: Date.now(),
        entered_by: input.session_id || 'unknown',
        from_phase: currentPhase
      });
      // Cap at 50 entries
      const trimmedHistory = phaseHistory.slice(-50);

      const recurrenceCount = { ...(effectiveState.phase_recurrence_count || {}) };
      recurrenceCount[newPhase] = (recurrenceCount[newPhase] || 0) + 1;

      // Absolute values, so a Write that dropped or copied them cannot win (see deferBookkeeping).
      const transitionPatch = {
        phase_history: trimmedHistory,
        phase_recurrence_count: recurrenceCount
      };
      if (typeof effectiveState.recurrence_reset_ts === 'number') {
        transitionPatch.recurrence_reset_ts = effectiveState.recurrence_reset_ts;
      }

      if (recurrenceResult.action === 'warn') {
        deferBookkeeping(input, 'transition', newPhase, transitionPatch);

        process.stderr.write(`[FSM-GUARD] WARN: ${recurrenceResult.message}\n`);
        const warnText = budgetedContext(recurrenceResult.message, input);
        if (warnText) {
          process.stdout.write(JSON.stringify({ additionalContext: warnText }) + '\n');
        }
        timer.end({ status: 'recurrence_warn', phase: newPhase, count: recurrenceResult.entered, exit: 0 });
        process.exit(0);
      }

      // action === 'pass' — history lands in PostToolUse, after the write
      deferBookkeeping(input, 'transition', newPhase, transitionPatch);

      // Legacy: also check old-style phase_history for fix_loop_stuck signal
      // (keep backward compat with existing logic that used recentPhases). Counted from the
      // last reset, like the ladder itself.
      const recentPhases = [
        ...countedHistory(effectiveState).map(h => h.phase), newPhase
      ].slice(-6);
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
