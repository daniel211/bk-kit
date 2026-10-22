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
//
// The decision itself — transition table, new-episode detection, the recurrence ladder, the
// history and count to record — lives in lib/fsm-phase-transition.cjs, shared with
// `bk-health --set-phase`, which changes the phase without the conductor's Read + Edit. This
// file carries the verdict out for a Write/Edit: deny, or stash the bookkeeping for PostToolUse.

'use strict';

// Outer crash wrapper — fail-closed (guard must block even when broken)
try {
  const { createHookTimer } = require('./lib/hook-logger.cjs');
  const {
    isHookEnabled, readWorkflowState, writeWorkflowState, workflowStatePath
  } = require('./lib/bk-config-utils.cjs');
  const { pendingKey, stashPending, takePending } = require('./lib/fsm-pending-bookkeeping.cjs');
  const { loadHarnessPolicy, trackRedSignal, trackViolation, trackWarnSignal } = require('./lib/harness-policy-loader.cjs');
  const { proposedState, reviewBookkeepingWrite } = require('./lib/workflow-state-bookkeeping-guard.cjs');
  const {
    extractStringField, decidePhaseWrite, haltPausePatch, recordRefusal
  } = require('./lib/fsm-phase-transition.cjs');
  const fs = require('fs');

  // Advisory context is subject to the shared injection budget (cap + dedupe). The deny paths
  // below (`permissionDecision: "deny"` + exit 2) deliberately do NOT go through it — a block
  // reason must always reach the model. Optional lib: absent → text goes out unchanged.
  let injectionBudget = null;
  try { injectionBudget = require('./lib/injection-budget.cjs'); } catch { /* optional */ }

  // Optional: the project root the testing-evidence check reads the plan dir from. Without it
  // the check still sees recorded evidence and agent dispatches, just not plan reports.
  function projectRootOrNull(input) {
    try { return require('./lib/resolve-project-root.cjs').resolveProjectRoot(input); } catch { return null; }
  }

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

  /** A PreToolUse deny: the reason goes to the model, the tool never runs. */
  function denyPreToolUse(reason) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason
      }
    }) + '\n');
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

      const decision = decidePhaseWrite({
        currentState,
        newPhase,
        // The type the incoming write declares. Only consulted for restart detection: a new
        // episode may switch workflows (`bk-code` commits, `bk-debug` starts), and validation
        // of an in-flight workflow still goes by what is on disk.
        newWorkflowType:
          extractStringField(newContent, 'workflow_type') || extractStringField(newContent, 'command'),
        // What the write claims to be working on. A terminal phase plus a different feature is
        // the next workflow starting, even when the phase string has not moved.
        newFeature: extractStringField(newContent, 'feature'),
        newWorkflowId: extractStringField(newContent, 'workflowId'),
        // Evidence the write itself declares (an Edit adding "testing_evidence": "...").
        newTestingEvidence: extractStringField(newContent, 'testing_evidence'),
        // Marker of an explicit reopen from `commit` (commit → coding|testing).
        reopenReason: extractStringField(newContent, 'reopen_reason'),
        get root() { return projectRootOrNull(input); },
        // A new episode decides before any review — its reset overwrites the bookkeeping the
        // write carried — so the review is only computed when it is needed.
        get review() { return reviewStateWrite(toolInput, currentState); },
        getPolicy: () => loadHarnessPolicy(),
        enteredBy: input.session_id || 'unknown'
      });
      const refusalCtx = { trackViolation, trackRedSignal, tool: input.tool_name || 'Write', target: targetFile };

      switch (decision.verdict) {
        case 'new_episode':
          // Deferred to PostToolUse, like every allowed write's bookkeeping.
          deferBookkeeping(input, 'new_episode', decision.phase, decision.patch);
          timer.end({ status: 'new_episode', from: decision.from, to: decision.phase, exit: 0 });
          process.exit(0);
          break;

        case 'tamper':
          recordRefusal(decision, refusalCtx);
          process.stderr.write(`[FSM-GUARD] BLOCK: write rewrites hook-owned "${decision.field}"\n`);
          denyPreToolUse(decision.message);
          timer.end({ status: 'bookkeeping_tamper', field: decision.field, exit: 2 });
          process.exit(2);
          break;

        case 'no_transition':
          // Restore what the write dropped and stamp a batch-boundary reset, after it lands.
          if (decision.pending) {
            deferBookkeeping(input, decision.pending.kind, decision.pending.phase, decision.pending.patch);
          }
          timer.end({ status: decision.status, exit: 0 });
          process.exit(0);
          break;

        case 'unknown_workflow':
          timer.end({ status: 'unknown_workflow', exit: 0 });
          process.exit(0);
          break;

        case 'invalid':
          process.stderr.write(decision.message);
          recordRefusal(decision, refusalCtx);
          timer.end({ status: 'blocked', from: decision.from, to: decision.to, exit: 2 });
          process.exit(2);
          break;

        case 'halt':
          // Only the pause is written. Writing in PreToolUse is safe on the deny paths only: the
          // tool never runs, so there is no Read→Write pair for this write to invalidate.
          try { writeWorkflowState(haltPausePatch()); } catch { /* fail-open on write */ }
          recordRefusal(decision, refusalCtx);
          process.stderr.write(`[FSM-GUARD] HALT: phase recurrence hard block on "${decision.to}"\n`);
          denyPreToolUse(decision.recurrence.message);
          timer.end({ status: 'recurrence_halt', phase: decision.to, count: decision.recurrence.entered, exit: 2 });
          process.exit(2);
          break;

        case 'block':
          // Nothing is written — a refused transition is not history.
          recordRefusal(decision, refusalCtx);
          process.stderr.write(`[FSM-GUARD] BLOCK: phase recurrence on "${decision.to}" (count=${decision.recurrence.entered})\n`);
          denyPreToolUse(decision.recurrence.message);
          timer.end({ status: 'recurrence_block', phase: decision.to, count: decision.recurrence.entered, exit: 2 });
          process.exit(2);
          break;

        default: {
          // 'transition' — history lands in PostToolUse, after the write
          deferBookkeeping(input, 'transition', decision.to, decision.patch);
          const { recurrence } = decision;

          // testing -> review without test evidence: advise and record, never block. Delivered
          // here (PreToolUse additionalContext reaches the conductor, whose Edit this is) rather
          // than through the conductor inbox, which exists for SubagentStop output.
          const testing = decision.testing;
          let testingText = null;
          if (testing && testing.advisory) {
            if (testing.signal) {
              try { trackWarnSignal(testing.signal.type, testing.signal.meta); } catch { /* best-effort */ }
            }
            testingText = budgetedContext(testing.advisory, input);
          }

          if (recurrence.action === 'warn') {
            process.stderr.write(`[FSM-GUARD] WARN: ${recurrence.message}\n`);
            const warnText = budgetedContext(recurrence.message, input);
            const both = [warnText, testingText].filter(Boolean).join('\n');
            if (both) {
              process.stdout.write(JSON.stringify({ additionalContext: both }) + '\n');
            }
            timer.end({ status: 'recurrence_warn', phase: decision.to, count: recurrence.entered, exit: 0 });
            process.exit(0);
          }

          if (decision.signal) {
            const signalText = budgetedContext(decision.signal, input);
            const both = [signalText, testingText].filter(Boolean).join('\n');
            if (both) {
              process.stdout.write(JSON.stringify({ additionalContext: both }) + '\n');
            }
            timer.end({ status: 'ok_with_signal', from: decision.from, to: decision.to, loopCount: decision.loopCount, exit: 0 });
            process.exit(0);
          }

          if (testingText) {
            process.stdout.write(JSON.stringify({ additionalContext: testingText }) + '\n');
          }
          timer.end({
            status: 'ok', from: decision.from, to: decision.to, exit: 0,
            ...(testing ? { testing_evidence: testing.kind } : {})
          });
          process.exit(0);
        }
      }
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
