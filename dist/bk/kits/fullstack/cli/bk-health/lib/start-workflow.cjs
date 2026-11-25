'use strict';
/**
 * start-workflow.cjs — `bk-health --start <workflow> --feature <slug>`: open a workflow in
 * .workflow-state.json in one locked write, instead of the conductor writing the file itself.
 *
 * Why: --set-phase moves a workflow, but nothing OPENED one. bk-plan step 2a and bk-code
 * Code-Step-1 told the conductor to write workflow_type / feature / plan_dir / platform / the
 * opening phase by hand. In X-Game-Pro (0.19.0) it did that ~25 times in 6 days through python /
 * node heredocs in Bash — which fsm-guard never sees — and hand-cleared the previous feature's
 * signals (`signal_count`, `retry_agents`, `last_signal`) after a stale "bk-android-developer
 * failed 2 times" warning followed it into a new feature. When it used Edit instead, switching
 * workflow_type and phase in two writes hit `Invalid transition in bk-plan: "commit" → "plan"`.
 *
 * What it writes, all at once:
 *   - workflow_type + command, feature, workflowId, plan_dir (default bk/dev/<feature>),
 *     platform (kept from disk unless given), the workflow's opening phase from fsm-guard's own
 *     transition table (bk-plan: planning, bk-code: plan, bk-debug: classify, bk-refactor: analyze);
 *   - a new episode — previous_episode, workflow_episode + 1, phase_history / counts starting at
 *     the opening phase — built by the hook lib's openEpisodePatch(), the code fsm-guard runs for
 *     an opening-phase write over a finished workflow, and judged first by decidePhaseWrite();
 *   - the previous workflow's per-workflow fields cleared (PER_WORKFLOW_RESET, fix budgets);
 *   - `--field k=v` extras (total_batches, complexity_tier, review_mode, ...).
 * Everything else — cost tally, dispatch counts, halt flags, skills_loaded — is cross-workflow and
 * kept.
 *
 * Refusals (exit 2, nothing written):
 *   - a coding workflow (bk-code / bk-debug / bk-refactor) is in flight — any non-terminal phase,
 *     `escalated` included — for another workflow or feature, or the same one (that is a resume:
 *     use --set-phase). `--force` opens the new one anyway; previous_episode records `forced`.
 *     An in-flight bk-plan never refuses another workflow: fsm-guard treats a plan as abandonable.
 *     Re-starting the SAME in-flight plan is a resume and is refused like the others.
 *   - the workflow is paused by a recurrence HARD BLOCK. `--force` does not lift that: the pause
 *     is the user's decision (`--resume --force`, which they run).
 */

const { requireHookLib } = require('./kit-hook-lib.cjs');
const { resolveCliProjectRoot } = require('./project-root.cjs');
const { parseField } = require('./set-phase.cjs');

/**
 * What the previous workflow leaves behind that must not be read as the new one's, and the value
 * it is cleared to. Only keys already on disk are cleared, so a bk-plan state never grows
 * bk-refactor fields. The fix budgets come from the hook lib's FIX_BUDGET_FIELDS (shared with the
 * reopen and batch-boundary resets).
 */
const PER_WORKFLOW_RESET = {
  // batch progress
  batch: null, total_batches: null, completed_batches: [],
  // plan sizing (complexity-detector writes the last three)
  complexity_tier: null, review_mode: null, suggested_effort_overrides: null, effort_reason: null,
  // reactive signals (agent-signal-detector) — the field case above
  signal_count: 0, retry_agents: [], last_signal: null,
  // agents and evidence of the last run
  dev_agent_id: null, reviewer_agent_id: null,
  testing_evidence: null, testing_evidence_result: null, testing_evidence_warned_batch: null,
  reopen_reason: null,
  // bk-debug / bk-refactor working fields
  issue_type: null, fix_guidance: null, brainstorm_complete: false, research_complete: false,
  refactor_type: null, affected_files: []
};

/** Keys the flags own, plus the episode bookkeeping — `--field` must not be a second spelling. */
const NOT_A_FIELD = new Set([
  'workflow_type', 'command', 'feature', 'plan_dir', 'platform', 'workflowId', 'current_phase',
  'phase_history', 'phase_recurrence_count', 'recurrence_reset_ts',
  'workflow_episode', 'previous_episode', 'reopen_count', 'workflow_paused', 'pause_reason'
]);

const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const USAGE = 'Usage: --start <bk-plan|bk-code|bk-debug|bk-refactor> --feature <slug> ' +
  '[--plan-dir <dir>] [--platform <p>] [--field key=value]... [--force]';

const fail = (exitCode, message) => ({ success: false, exitCode, message: `[bk-health] ${message}` });

/**
 * @param {{projectRoot?: string, workflow: string, feature?: string, planDir?: string|null,
 *          platform?: string|null, fields?: string[], force?: boolean, sessionId?: string|null}} opts
 * @returns {{success: boolean, exitCode: number, message: string}}
 */
function startWorkflow(opts = {}) {
  const root = resolveCliProjectRoot(opts.projectRoot);
  const fsm = requireHookLib('fsm-phase-transition.cjs');
  const cfg = requireHookLib('bk-config-utils.cjs');
  const ident = requireHookLib('workflow-identity.cjs');
  if (!fsm || !cfg || !ident || !fsm.openEpisodePatch) {
    return fail(1, 'kit hook libs not found beside the CLI — cannot open the workflow.');
  }

  const type = String(opts.workflow || '').trim();
  const opening = ((fsm.TRANSITIONS[type] || {}).null || [])[0];
  if (!opening) {
    return fail(1, `--start: unknown workflow "${type}" (known: ${Object.keys(fsm.TRANSITIONS).join(', ')}).\n${USAGE}`);
  }
  const feature = String(opts.feature || '').trim();
  if (!SLUG.test(feature)) return fail(1, `--start needs --feature <slug> (letters, digits, . _ -), got "${feature}".\n${USAGE}`);

  const extras = {};
  for (const raw of opts.fields || []) {
    const kv = parseField(raw);
    if (!kv) return fail(1, `--field expects key=value, got "${raw}".`);
    if (NOT_A_FIELD.has(kv[0])) return fail(1, `--field ${kv[0]}: set by --start itself (or by fsm-guard), not by --field.`);
    extras[kv[0]] = kv[1];
  }

  const declared = {
    workflow_type: type,
    command: type,
    feature,
    workflowId: ident.resolveWorkflowId({ command: type, feature }, null),
    plan_dir: opts.planDir ? String(opts.planDir).replace(/\/+$/, '') : `bk/dev/${feature}`
  };
  if (opts.platform) declared.platform = String(opts.platform);

  let refusal = null;
  let summary = null;
  const written = cfg.writeWorkflowState((fresh) => {
    const state = fresh || {};
    const onDisk = state.workflow_type || state.command || null;
    const phase = state.current_phase || null;
    const known = Boolean(onDisk && fsm.TRANSITIONS[onDisk]);
    const inFlight = known && phase !== null && !fsm.TERMINAL_PHASES.has(phase);

    if (state.workflow_paused) {
      refusal = `the workflow is paused (${state.pause_reason || 'paused'}) — --start does not lift a pause. ` +
        'AskUserQuestion; resuming needs the user to run: node .claude/cli/bk-health/index.cjs --resume --force';
      return null;
    }

    // The FSM's own verdict on writing the opening phase with this identity. Over a finished
    // workflow, or over a plan, it is a new episode — the path fsm-guard takes for an Edit.
    const decision = fsm.decidePhaseWrite({
      currentState: state,
      newPhase: opening,
      newWorkflowType: type,
      newFeature: feature,
      newWorkflowId: declared.workflowId,
      review: null,
      getPolicy: () => ({}),
      enteredBy: opts.sessionId || 'bk-health-cli',
      honorBypassEnv: false
    });

    let episode;
    let forced = false;
    if (decision.verdict === 'new_episode') {
      episode = decision.patch;
    } else if (!inFlight) {
      // Nothing the FSM knows is running (no state, no phase, a type it has no table for):
      // fsm-guard would let any write through, so the episode is opened here, the same way.
      episode = fsm.openEpisodePatch(state, opening, opts.sessionId || 'bk-health-cli');
    } else if (opts.force) {
      episode = fsm.openEpisodePatch(state, opening, opts.sessionId || 'bk-health-cli');
      episode.previous_episode = { ...episode.previous_episode, forced: true };
      forced = true;
    } else {
      const same = onDisk === type && state.feature === feature;
      refusal = same
        ? `${type} for "${feature}" is already open at "${phase}" — that is a resume, not a start: ` +
          'continue with --set-phase. (--force restarts it with fresh counters, discarding its progress.)'
        : `${onDisk} for "${state.feature || 'unknown'}" is in flight at "${phase}". Finish it, write ` +
          '`escalated`/`aborted` through --set-phase, or AskUserQuestion — --force opens the new workflow ' +
          'anyway and leaves that one\'s work uncommitted.';
      return null;
    }

    const cleared = {};
    for (const [k, v] of Object.entries(PER_WORKFLOW_RESET)) {
      if (k in state) cleared[k] = Array.isArray(v) ? [] : v;
    }
    Object.assign(cleared, fsm.fixBudgetResetPatch(state));

    const prev = episode.previous_episode;
    const changed = Object.keys(cleared).filter((k) =>
      JSON.stringify(state[k]) !== JSON.stringify(cleared[k]) && !(k in extras));
    summary = `[bk-health] started ${type} "${feature}" at ${opening} — episode ${episode.workflow_episode}` +
      (prev ? `, previous ${prev.workflow_type || 'none'} "${prev.feature || '-'}" ended at ${prev.ended_phase || 'none'}` +
        (forced ? ' (forced)' : '') : '') +
      `; plan_dir ${declared.plan_dir}` +
      (changed.length > 0 ? `; cleared ${changed.join(', ')}` : '') +
      (Object.keys(extras).length > 0
        ? '; ' + Object.entries(extras).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ') : '');

    return { ...cleared, ...extras, ...declared, current_phase: opening, ...episode };
  }, root);

  if (refusal) return fail(2, refusal);
  if (!written || !summary) {
    return fail(1, 'workflow-state write failed (lock busy or disk error) — nothing changed; retry.');
  }
  return { success: true, exitCode: 0, message: summary };
}

module.exports = { startWorkflow, PER_WORKFLOW_RESET };
