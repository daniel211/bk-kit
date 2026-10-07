'use strict';
/**
 * set-phase.cjs — `bk-health --set-phase <phase> [--batch <N|next>]`: move the workflow without
 * the conductor reading and editing .workflow-state.json.
 *
 * Why a CLI: in X-Game-Pro (0.12.x, 6 conductor sessions) the conductor Read
 * bk/dev/shared/.workflow-state.json 47 times (~24k tokens), most of them only to change
 * `current_phase` with Read + Edit. The file is written by hooks too, so the Edit often failed
 * with "File has been modified since read" and the conductor paid for the Read a second time.
 * One Bash call that reads, validates and writes under the state lock costs neither.
 *
 * It must not become a way around fsm-guard. The verdict comes from the hook lib's
 * decidePhaseWrite() (hooks/lib/fsm-phase-transition.cjs), the function fsm-guard itself runs
 * for a conductor Edit of current_phase: the same transition table, new-episode rule,
 * recurrence ladder, phase_history / phase_recurrence_count bookkeeping and batch-boundary
 * `recurrence_reset_ts`. The only difference is timing: fsm-guard stashes the bookkeeping in
 * PreToolUse and merges it in PostToolUse because the Write happens between the two; here the
 * phase and its bookkeeping land in one writeWorkflowState() call, so there is nothing to stash.
 * A refusal prints fsm-guard's own message, writes nothing (a HARD BLOCK writes only the pause,
 * as fsm-guard does) and exits 2.
 *
 * There is deliberately no fallback without the hook lib: an unvalidated phase write is exactly
 * what the guard exists to stop, so a CLI without the kit's hooks beside it refuses.
 */

const { requireHookLib } = require('./kit-hook-lib.cjs');
const { resolveCliProjectRoot } = require('./project-root.cjs');

/**
 * The recurrence override is honoured by fsm-guard only (see checkPhaseRecurrence() in the hook
 * lib). Said on the CLI's recurrence refusals, whose message otherwise names the override as if
 * it applied here too.
 */
const OVERRIDE_NOTE =
  'bk-health --set-phase never applies the recurrence override; in a session started with it, ' +
  'Edit current_phase instead (fsm-guard honours it there).';

/**
 * Parse the `--batch` value against the batch on disk.
 * @param {string|number} raw - "next" or an integer
 * @param {object} state
 * @returns {{ok: true, batch: number}|{ok: false, message: string}}
 */
function resolveBatch(raw, state) {
  const current = Number(state.batch);
  const hasCurrent = Number.isFinite(current);
  const target = String(raw).trim() === 'next'
    ? (hasCurrent ? current : 0) + 1
    : Number(raw);
  if (!Number.isInteger(target) || target < 1) {
    return { ok: false, message: `--batch expects a batch number or "next", got "${raw}".` };
  }
  // fsm-guard only starts a fresh recurrence window when the batch goes UP; a batch write that
  // does not advance would reset the count alone, which is the fix-loop escape the window exists
  // to catch. The CLI's --batch is the batch-boundary write, so it has to advance.
  if (hasCurrent && target <= current) {
    return { ok: false, message: `--batch ${target} does not advance the batch (on disk: ${current}). ` +
      'The batch-boundary write is batch N+1 at a COMPLETED batch.' };
  }
  return { ok: true, batch: target };
}

/** True when state.batch is unset/non-numeric and total_batches is a positive integer. */
function needsBatchSeed(state) {
  const batch = state.batch;
  const hasBatch = batch !== null && batch !== undefined && batch !== '' && Number.isFinite(Number(batch));
  const total = Number(state.total_batches);
  return !hasBatch && Number.isInteger(total) && total > 0;
}

/**
 * `--field key=value` → [key, value]. The value is JSON when it parses (numbers, booleans, null,
 * quoted strings), the raw text otherwise, so `--field dev_agent_id=a1b2` needs no quoting.
 * @param {string} raw
 * @returns {[string, *]|null}
 */
function parseField(raw) {
  const text = String(raw);
  const eq = text.indexOf('=');
  if (eq <= 0) return null;
  const key = text.slice(0, eq).trim();
  const rawValue = text.slice(eq + 1);
  let value = rawValue;
  try { value = JSON.parse(rawValue); } catch { /* plain string */ }
  return key ? [key, value] : null;
}

/** Keys the dedicated flags own — `--field` must not become a second, unchecked spelling. */
const FLAG_OWNED = new Set(['current_phase', 'batch']);

/**
 * The conductor's own fields that ride along with a phase change (`--inc quality_fix_count`,
 * `--field reviewer_agent_id=…`), so a fix-loop transition needs no Read + Edit either.
 * Hook-owned fields are NOT filtered here: they go into the reviewed document like any Edit's
 * content, and fsm-guard's bookkeeping review refuses them the same way.
 *
 * @returns {{ok: true, fields: object}|{ok: false, message: string}}
 */
function extraFields(opts, fresh) {
  const fields = {};
  for (const raw of opts.fields || []) {
    const kv = parseField(raw);
    if (!kv) return { ok: false, message: `--field expects key=value, got "${raw}".` };
    if (FLAG_OWNED.has(kv[0])) {
      return { ok: false, message: `--field ${kv[0]}: use --set-phase / --batch ` +
        '(e.g. `--set-phase coding --batch 1`, or `--batch 1` alone to seed the first batch).' };
    }
    fields[kv[0]] = kv[1];
  }
  for (const name of opts.inc || []) {
    const key = String(name).trim();
    if (!key || FLAG_OWNED.has(key)) return { ok: false, message: `--inc expects a counter field, got "${name}".` };
    const current = Number(fresh[key]);
    fields[key] = (Number.isFinite(current) ? current : 0) + 1;
  }
  return { ok: true, fields };
}

/** One-line description of what landed. */
function describe(decision, fields, before, seeded) {
  const parts = [];
  if (decision.verdict === 'new_episode') {
    parts.push(`new episode ${decision.patch.workflow_episode}: ${decision.from || 'none'} → ${decision.phase}`);
  } else if (decision.verdict === 'transition' || decision.verdict === 'unknown_workflow') {
    const wf = before.workflow_type || before.command || 'workflow';
    const count = decision.patch && decision.patch.phase_recurrence_count
      ? ` (entry ${decision.patch.phase_recurrence_count[decision.to]} since the last reset)` : '';
    parts.push(`${wf}: ${decision.from || 'none'} → ${decision.to}${count}`);
  } else if (fields.current_phase) {
    parts.push(`phase already "${fields.current_phase}"`);
  }
  if (seeded) {
    parts.push('batch seeded to 1 (total_batches ' + before.total_batches + ')');
  } else if (fields.batch !== undefined) {
    parts.push(`batch ${before.batch === undefined ? 'none' : before.batch} → ${fields.batch}, recurrence counts reset`);
  }
  const extras = Object.keys(fields).filter((k) => !['current_phase', 'batch', 'phase_recurrence_count'].includes(k));
  if (extras.length > 0) parts.push(extras.map((k) => `${k}=${JSON.stringify(fields[k])}`).join(' '));
  return `[bk-health] ${parts.join('; ') || 'nothing to change'}`;
}

/**
 * @param {{projectRoot?: string, phase?: string|null, batch?: string|number|null,
 *          inc?: string[], fields?: string[], sessionId?: string|null}} opts
 * @returns {{success: boolean, exitCode: number, message: string, advisory?: string|null, verdict?: string}}
 */
function setPhase(opts = {}) {
  const root = resolveCliProjectRoot(opts.projectRoot);
  const phase = opts.phase ? String(opts.phase).trim() : null;
  const batchArg = opts.batch === undefined || opts.batch === null ? null : opts.batch;
  if (!phase && batchArg === null) {
    return {
      success: false, exitCode: 1,
      message: 'Usage: --set-phase <phase> [--batch <N|next>] [--inc <field>] [--field key=value] | --batch <N|next>'
    };
  }

  const fsm = requireHookLib('fsm-phase-transition.cjs');
  const guard = requireHookLib('workflow-state-bookkeeping-guard.cjs');
  const cfg = requireHookLib('bk-config-utils.cjs');
  const policyLib = requireHookLib('harness-policy-loader.cjs');
  if (!fsm || !guard || !cfg || !policyLib) {
    return {
      success: false, exitCode: 1,
      message: '[bk-health] kit hook libs not found beside the CLI — cannot validate the transition. ' +
        'Edit current_phase in bk/dev/shared/.workflow-state.json instead (fsm-guard validates it).'
    };
  }

  // Loaded for THIS root before anything else: the policy is cached per process, and the
  // violation / red-signal logs it points at must be the project's, not the cwd's.
  const getPolicy = () => policyLib.loadHarnessPolicy({ projectRoot: root });
  getPolicy();

  let decision = null;
  let early = null;          // a refusal decided before the FSM ran (no state, bad --batch)
  let fields = {};
  let before = {};
  let seeded = false;        // batch=1 auto-seeded by `--set-phase coding`

  const written = cfg.writeWorkflowState((fresh) => {
    before = fresh || {};
    if (!fresh || Object.keys(fresh).length === 0) {
      early = 'No workflow state found — the workflow\'s first state write (Code-Step-1) is a full Write.';
      return null;
    }

    // Exactly what the conductor's Edit would have written.
    const extra = extraFields(opts, fresh);
    if (!extra.ok) { early = extra.message; return null; }
    fields = { ...extra.fields };
    if (phase) fields.current_phase = phase;
    if (batchArg !== null) {
      const b = resolveBatch(batchArg, fresh);
      if (!b.ok) { early = b.message; return null; }
      fields.batch = b.batch;
      fields.phase_recurrence_count = {};
    } else if (phase === 'coding' && needsBatchSeed(fresh)) {
      // The conductor never seeded `batch` (X-Game-Pro 0.13.4: batch stayed null for 3 batches, so
      // agent-trace rows carried batch=None and same-batch fix loops went uncounted). Seed the
      // first batch with the phase write. Counts are NOT reset: this is not a batch boundary.
      fields.batch = 1;
      seeded = true;
    }

    const after = { ...fresh, ...fields };
    decision = fsm.decidePhaseWrite({
      currentState: fresh,
      newPhase: phase,
      // What the write declares, as fsm-guard reads it from an Edit's content: a --field that
      // names another feature or workflow is a restart signal there, so it is one here.
      newWorkflowType: typeof fields.workflow_type === 'string' ? fields.workflow_type
        : (typeof fields.command === 'string' ? fields.command : null),
      newFeature: typeof fields.feature === 'string' ? fields.feature : null,
      newWorkflowId: typeof fields.workflowId === 'string' ? fields.workflowId : null,
      review: { ...guard.reviewBookkeepingWrite(fresh, after), after },
      // testing -> review evidence check (warn + record): the plan dir lives under the root, and
      // `--field testing_evidence=…` is how the conductor points at the report that holds the run.
      root,
      newTestingEvidence: typeof fields.testing_evidence === 'string' ? fields.testing_evidence : null,
      getPolicy,
      enteredBy: opts.sessionId || 'bk-health-cli',
      // Never from this process's env: see checkPhaseRecurrence() — a Bash prefix would do it.
      honorBypassEnv: false
    });

    switch (decision.verdict) {
      case 'new_episode':
      case 'transition':
        return { ...fields, ...decision.patch };
      case 'no_transition':
        return { ...fields, ...(decision.pending ? decision.pending.patch : {}) };
      case 'unknown_workflow':
        return fields;              // fsm-guard lets it through unvalidated, and so do we
      case 'halt':
        return fsm.haltPausePatch(); // the one write a refusal makes
      default:
        return null;                 // tamper / invalid / block: nothing is written
    }
  }, root);

  if (early) return { success: false, exitCode: 1, message: `[bk-health] ${early}` };
  if (!written || !decision) {
    return { success: false, exitCode: 1, message: '[bk-health] workflow-state write failed (lock busy or disk error) — nothing changed; retry.' };
  }

  if (['tamper', 'invalid', 'halt', 'block'].includes(decision.verdict)) {
    try {
      fsm.recordRefusal(decision, {
        trackViolation: policyLib.trackViolation,
        trackRedSignal: policyLib.trackRedSignal,
        tool: 'bk-health --set-phase',
        target: cfg.workflowStatePath(root)
      });
    } catch { /* telemetry never changes the verdict */ }
    const message = decision.verdict === 'halt' || decision.verdict === 'block'
      ? decision.recurrence.message + '\n' + OVERRIDE_NOTE
      : decision.message;
    return { success: false, exitCode: 2, verdict: decision.verdict, message: message.trimEnd() };
  }

  let advisory = null;
  if (decision.verdict === 'transition') {
    advisory = decision.recurrence && decision.recurrence.action === 'warn'
      ? decision.recurrence.message
      : decision.signal;
    const testing = decision.testing;
    if (testing && testing.advisory) {
      advisory = [advisory, testing.advisory].filter(Boolean).join('\n');
      try {
        if (testing.signal && policyLib.trackWarnSignal) {
          policyLib.trackWarnSignal(testing.signal.type, testing.signal.meta);
        }
      } catch { /* telemetry never changes the verdict */ }
    }
  }
  return { success: true, exitCode: 0, verdict: decision.verdict, message: describe(decision, fields, before, seeded), advisory };
}

module.exports = { setPhase, resolveBatch, parseField };
