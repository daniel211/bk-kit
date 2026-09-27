/**
 * fsm-phase-transition.cjs — the FSM's decision on a change to .workflow-state.json, as data.
 *
 * Split out of fsm-guard.cjs so a second writer can reach the same verdict. That writer is
 * `bk-health --set-phase` (cli/bk-health/lib/set-phase.cjs). In X-Game-Pro (0.12.x, 6 conductor
 * sessions) the conductor Read bk/dev/shared/.workflow-state.json 47 times (~24k tokens), most
 * of them only to change `current_phase` with Read + Edit — and the Edit often failed with "File
 * has been modified since read", because hooks write that file between the two calls. A CLI that
 * changes the phase in one locked write removes both costs, but only if it cannot become a way
 * around the guard: the allowed transitions, the recurrence ladder, the history and the
 * batch-boundary reset must be the SAME code on both paths. So the decision lives here and both
 * callers only carry out its side effects: fsm-guard as a PreToolUse verdict plus deferred
 * PostToolUse bookkeeping, the CLI as a single writeWorkflowState() under the state lock.
 *
 * Nothing here writes a file. decidePhaseWrite() is pure apart from reading the policy it is
 * handed and Date.now(); recordRefusal() is the one function with side effects (telemetry).
 */

'use strict';

const { countedHistory, windowEntryCount, recurrenceResetFields } = require('./phase-recurrence-window.cjs');
const { bookkeepingDenyMessage } = require('./workflow-state-bookkeeping-guard.cjs');

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

// Phases a workflow ends in. They have no outgoing edges *within* an episode — the only
// move out of one is starting a new workflow, handled by startsNewEpisode() below.
// `completed` is bk-plan's: a plan ends at approval, it never commits code.
const TERMINAL_PHASES = new Set(['commit', 'aborted', 'completed']);

/** The CLI the deny messages point at. */
const HEALTH_CLI = 'node .claude/cli/bk-health/index.cjs';

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
 * @param {object} currentState
 * @param {string} newPhase
 * @param {object} policy
 * @param {{honorBypassEnv?: boolean}} [opts] - false for a caller whose env the model controls
 * @returns {{action: string, exitCode?: number, entered?: number, message?: string}}
 */
function checkPhaseRecurrence(currentState, newPhase, policy, opts = {}) {
  const cfg = policy && policy.deadloop && policy.deadloop.phase_recurrence;
  if (!cfg || !cfg.enabled) return { action: 'pass' };

  const warnCount = cfg.warn_count || 2;
  const blockCount = cfg.block_count || 3;
  const haltCount = cfg.halt_count || 4;
  const bypassEnv = cfg.bypass_env || 'BK_HARNESS_RECURRENCE_OVERRIDE';

  // Check bypass env. Only a hook may honour it: a hook inherits the env of the Claude Code CLI,
  // which the user set when starting the session. The bk-health CLI runs from a Bash call, where
  // `BK_HARNESS_RECURRENCE_OVERRIDE=1 node …` is one prefix away — the model would be granting
  // itself the override the user is supposed to grant.
  if (opts.honorBypassEnv !== false && process.env[bypassEnv] === '1') return { action: 'pass' };

  const windowCount = windowEntryCount(currentState, newPhase);
  const countCount = ((currentState.phase_recurrence_count || {})[newPhase] || 0) + 1;
  const entered = Math.max(windowCount, countCount);

  // Counts as one compact line — the pretty-printed dump grew with the workflow and said
  // nothing the phase name and the count did not already say.
  const counts = JSON.stringify(currentState.phase_recurrence_count || {}).slice(0, 120);
  const basis = `(since the last batch/reset: count ${countCount}, recent history ${windowCount})`;
  const cli = HEALTH_CLI;
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
 * The text fsm-guard prints for a transition the table does not allow.
 * @returns {string}
 */
function invalidTransitionMessage(workflowType, currentPhase, newPhase, allowed, startType) {
  const openingPhases = ((TRANSITIONS[startType] || {}).null || []).join(', ');
  const restartHint = TERMINAL_PHASES.has(currentPhase)
    ? `"${currentPhase}" is terminal. To start the next workflow, write an opening ` +
      `phase [${openingPhases || 'see the transition table'}] — that opens a new ` +
      `episode with fresh counters.\n`
    : '';
  return (
    `[FSM-GUARD] Invalid transition in ${workflowType}: ` +
    `"${currentPhase}" → "${newPhase}"\n` +
    `Allowed from "${currentPhase}": [${allowed.join(', ') || 'none'}]\n` +
    restartHint
  );
}

/**
 * The FSM's verdict on one write of the state file.
 *
 * The order of the checks is fsm-guard's and it matters: a new episode is recognised before
 * anything else (a commit→commit write for a new feature must not reach the same-phase fast
 * path), bookkeeping tampering before the transition table, and the recurrence ladder judges
 * the state with this write's own count reset already applied.
 *
 * @param {object} p
 * @param {object} p.currentState - state on disk (non-null)
 * @param {string|null} p.newPhase - the phase the write names, or null
 * @param {string|null} [p.newWorkflowType] - workflow_type/command the write declares
 * @param {string|null} [p.newFeature] - feature the write declares
 * @param {string|null} [p.newWorkflowId] - workflowId the write declares
 * @param {object|null} p.review - reviewBookkeepingWrite() result plus `after`, or null when the
 *   resulting document cannot be known. Read after the new-episode check (may be a getter).
 * @param {function(): object} p.getPolicy - harness policy, only called when the ladder runs
 * @param {string} [p.enteredBy] - recorded as phase_history[].entered_by
 * @param {boolean} [p.honorBypassEnv] - false: ignore the recurrence override env (CLI callers)
 * @returns {object} one of
 *   { verdict: 'new_episode', phase, patch }
 *   { verdict: 'tamper', field, message }
 *   { verdict: 'no_transition', status, pending: {kind, phase, patch}|null }
 *   { verdict: 'unknown_workflow' }
 *   { verdict: 'invalid', workflowType, from, to, allowed, message }
 *   { verdict: 'halt'|'block', from, to, recurrence }
 *   { verdict: 'transition', from, to, patch, recurrence, signal, loopCount }
 */
function decidePhaseWrite(p) {
  const currentState = p.currentState;
  const newPhase = p.newPhase || null;
  const newWorkflowType = p.newWorkflowType || null;
  const enteredBy = p.enteredBy || 'unknown';

  const currentPhase = currentState.current_phase || null;
  // Accept either `workflow_type` (canonical) or `command` (schema documented in
  // rules/state-machine.md and the bk-debug/bk-refactor state files).
  const workflowType = currentState.workflow_type || currentState.command || null;

  // A finished workflow is not a dead end — starting the next one is allowed, and starts
  // its counters at zero so the previous episode's history cannot halt it.
  // This runs BEFORE the same-phase fast path: a commit→commit write for a NEW feature is
  // exactly the case the field repo got stuck on, and it would be unreachable below.
  const startType =
    (newWorkflowType && TRANSITIONS[newWorkflowType]) ? newWorkflowType : workflowType;
  const identity = {
    current: currentState,
    feature: p.newFeature || null,
    workflowId: p.newWorkflowId || null,
    workflowType: newWorkflowType
  };
  if (newPhase && startsNewEpisode(currentPhase, newPhase, startType, identity)) {
    // `feature` / `workflowId` are not in the patch: the write itself declares them (that is
    // how this branch was reached), so they land with it.
    return {
      verdict: 'new_episode',
      from: currentPhase,
      phase: newPhase,
      patch: {
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
          entered_by: enteredBy,
          from_phase: currentPhase
        }],
        phase_recurrence_count: { [newPhase]: 1 },
        // A fresh history needs no window start; this also drops one a Write carried over.
        recurrence_reset_ts: null
      }
    };
  }

  // --- Hook-owned bookkeeping is the hook's (lib/workflow-state-bookkeeping-guard.cjs) ---
  // Runs on every write that is not a new episode, including Edits that name no phase at
  // all: the field conductor's fabricated history came in exactly that way. Read only here —
  // fsm-guard passes it as a getter, so a new episode never pays for reading the file.
  const review = p.review || null;
  if (review && review.deny) {
    return { verdict: 'tamper', field: review.deny, from: currentPhase, message: bookkeepingDenyMessage(review.deny) };
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
    let pending = null;
    if (Object.keys(extraPatch).length > 0) {
      const kind = review.countsReset && review.batchAdvanced ? 'batch_reset' : 'bookkeeping';
      pending = { kind, phase: review.after.current_phase || null, patch: extraPatch };
    }
    return { verdict: 'no_transition', status: newPhase ? 'same_phase' : 'no_phase_change', from: currentPhase, pending };
  }

  // If no workflow type, we can't validate — pass through
  if (!workflowType || !TRANSITIONS[workflowType]) {
    return { verdict: 'unknown_workflow', from: currentPhase, to: newPhase };
  }

  const stateKey = currentPhase === null ? 'null' : currentPhase;
  const allowed = TRANSITIONS[workflowType][stateKey] || [];

  if (!allowed.includes(newPhase)) {
    return {
      verdict: 'invalid',
      workflowType,
      from: currentPhase,
      to: newPhase,
      allowed,
      message: invalidTransitionMessage(workflowType, currentPhase, newPhase, allowed, startType)
    };
  }

  // --- H1-04: Phase recurrence detection ---
  const recurrence = checkPhaseRecurrence(effectiveState, newPhase, p.getPolicy(), {
    honorBypassEnv: p.honorBypassEnv !== false
  });

  // A refused transition never happened, so it is not history. Both deny paths used to
  // append the attempt to phase_history and bump its count, so every retry of a blocked
  // write made the next decision worse: in X-Game-Pro (0.12.2) three retries of
  // coding→testing turned a block into a HARD BLOCK and left `testing, testing, testing`
  // in the history of a workflow still sitting at `coding`, and the conductor reported
  // "each time I edit this file fsm-guard adds a new testing entry".
  if (recurrence.action === 'halt' || recurrence.action === 'block') {
    return { verdict: recurrence.action, from: currentPhase, to: newPhase, recurrence };
  }

  // Allowed: the transition is recorded.
  const phaseHistory = [...(effectiveState.phase_history || [])];
  phaseHistory.push({
    phase: newPhase,
    ts: Date.now(),
    entered_by: enteredBy,
    from_phase: currentPhase
  });
  // Cap at 50 entries
  const trimmedHistory = phaseHistory.slice(-50);

  const recurrenceCount = { ...(effectiveState.phase_recurrence_count || {}) };
  recurrenceCount[newPhase] = (recurrenceCount[newPhase] || 0) + 1;

  // Absolute values, so a Write that dropped or copied them cannot win.
  const patch = {
    phase_history: trimmedHistory,
    phase_recurrence_count: recurrenceCount
  };
  if (typeof effectiveState.recurrence_reset_ts === 'number') {
    patch.recurrence_reset_ts = effectiveState.recurrence_reset_ts;
  }

  // Legacy: also check old-style phase_history for fix_loop_stuck signal
  // (keep backward compat with existing logic that used recentPhases). Counted from the
  // last reset, like the ladder itself. Only on a plain pass — a warn already said it.
  let signal = null;
  let loopCount = 0;
  if (recurrence.action === 'pass') {
    const recentPhases = [
      ...countedHistory(effectiveState).map(h => h.phase), newPhase
    ].slice(-6);
    loopCount = recentPhases.filter(ph => ph === newPhase).length;
    if (loopCount >= 3) {
      signal = `[REACTIVE-SIGNAL: fix_loop_stuck] (HIGH) Phase "${newPhase}" entered ${loopCount} times — fix loop. ` +
        'Task(bk-problem-solving), else bk-brainstormer; AskUserQuestion if both fail. ' +
        'Detail: rules/reactive-orchestration.md §3.';
    }
  }

  return { verdict: 'transition', from: currentPhase, to: newPhase, patch, recurrence, signal, loopCount };
}

/** Pause fields a HARD BLOCK writes — the only state a refusal ever writes. */
function haltPausePatch() {
  return {
    workflow_paused: true,
    pause_reason: 'phase_recurrence_hard_block',
    pause_ts: Date.now()
  };
}

/**
 * Log a refusal the way fsm-guard always has: a violation per attempt, and a red signal for the
 * recurrence refusals (which is what global-kill-switch counts). Repeated attempts are logged
 * per attempt — that is what they are — but never climb the ladder (see decidePhaseWrite()).
 *
 * @param {object} decision - from decidePhaseWrite()
 * @param {{trackViolation: function, trackRedSignal: function, tool: string, target: string}} ctx
 */
function recordRefusal(decision, ctx) {
  const { trackViolation, trackRedSignal, tool, target } = ctx;
  if (decision.verdict === 'tamper') {
    trackViolation({
      hook: 'fsm-guard',
      violation_type: 'bookkeeping_tamper',
      tool,
      target,
      blocked: true,
      severity: 'error',
      context: { field: decision.field, phase: decision.from }
    });
  } else if (decision.verdict === 'invalid') {
    trackViolation({
      hook: 'fsm-guard',
      violation_type: 'invalid_transition',
      tool,
      target,
      blocked: true,
      severity: 'error',
      context: { workflow: decision.workflowType, from: decision.from, to: decision.to, allowed: decision.allowed }
    });
  } else if (decision.verdict === 'halt' || decision.verdict === 'block') {
    const count = decision.recurrence.entered;
    trackRedSignal('phase_recurrence_blocked', { phase: decision.to, count, from: decision.from });
    trackViolation({
      hook: 'fsm-guard',
      violation_type: decision.verdict === 'halt' ? 'phase_recurrence_halt' : 'phase_recurrence_block',
      blocked: true,
      severity: 'red',
      context: { phase: decision.to, count }
    });
  }
}

module.exports = {
  TRANSITIONS,
  TERMINAL_PHASES,
  ABANDONABLE_WORKFLOWS,
  extractStringField,
  startsNewEpisode,
  checkPhaseRecurrence,
  decidePhaseWrite,
  haltPausePatch,
  recordRefusal
};
