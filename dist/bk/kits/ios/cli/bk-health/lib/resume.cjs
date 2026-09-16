'use strict';
/**
 * resume.cjs — Resume a paused/halted workflow or reset dispatch counts.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { requireHookLib } = require('./kit-hook-lib.cjs');
const { resolveCliProjectRoot } = require('./project-root.cjs');

function readJson(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

function getStateFile(projectRoot) {
  const lib = requireHookLib('bk-config-utils.cjs');
  if (lib && typeof lib.workflowStatePath === 'function') return lib.workflowStatePath(projectRoot);
  return path.join(projectRoot, 'bk', 'dev', 'shared', '.workflow-state.json');
}

/**
 * Read workflow state the way the hooks read it — including the .bak and checkpoint
 * fallbacks, so the CLI does not report "no workflow state" over a recoverable one.
 *
 * @param {string} root - Project root
 * @returns {Object|null}
 */
function readState(root) {
  const lib = requireHookLib('bk-config-utils.cjs');
  if (lib && typeof lib.readWorkflowState === 'function') return lib.readWorkflowState(root);
  return readJson(getStateFile(root));
}

/**
 * Update workflow state through the kit's writer.
 *
 * Both commands here read the state, prompt the user, and only then write — a gap long
 * enough for any hook to write in between. Going through writeWorkflowState puts the
 * decision inside the same lock the hooks take, on state read there, so a resume cannot
 * quietly revert whatever landed while the user was reading the prompt.
 *
 * The direct write is the fallback for a CLI running without the kit's hooks beside it.
 *
 * @param {string} root - Project root
 * @param {function(Object): (Object|null)} updater - Receives fresh state, returns fields to merge
 * @returns {boolean} true when the state on disk reflects the update
 */
function updateState(root, updater) {
  const lib = requireHookLib('bk-config-utils.cjs');
  if (lib && typeof lib.writeWorkflowState === 'function') {
    return lib.writeWorkflowState(updater, root);
  }
  // Fallback: no hook lib next to the CLI. Unlocked, but still atomic via tmp + rename.
  const stateFile = getStateFile(root);
  const patch = updater(readJson(stateFile) || {});
  if (patch === null || typeof patch !== 'object') return true;
  const next = { ...(readJson(stateFile) || {}), ...patch, updated_at: new Date().toISOString() };
  const tmp = stateFile + '.' + Math.random().toString(36).slice(2);
  try {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
    fs.renameSync(tmp, stateFile);
    return true;
  } catch {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    return false;
  }
}

/**
 * Prompt user for confirmation on stdin.
 * @param {string} prompt
 * @returns {Promise<boolean>}
 */
function askConfirm(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${prompt} [yes/no]: `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'yes');
    });
  });
}

/**
 * Resume a halted/paused workflow.
 * @param {{ projectRoot: string, force?: boolean }} opts
 * @returns {{ success: boolean, message: string }}
 */
async function resumeWorkflow(opts = {}) {
  const root = resolveCliProjectRoot(opts.projectRoot);
  const state = readState(root);

  if (!state) {
    return { success: false, message: 'No workflow state found.' };
  }

  if (!state.global_halt && !state.workflow_paused) {
    return { success: true, message: 'Workflow is not halted or paused — no action needed.' };
  }

  const reasons = [];
  if (state.global_halt) reasons.push('global_halt');
  if (state.workflow_paused) reasons.push('workflow_paused');

  if (!opts.force) {
    const confirmed = await askConfirm(
      `This will clear: ${reasons.join(', ')}.\n` +
      `Halt reasons: ${(state.halt_reasons || []).join(', ') || 'none'}\n` +
      `Confirm resume?`
    );
    if (!confirmed) {
      return { success: false, message: 'Resume cancelled by user.' };
    }
  }

  // Clear the halt against the state as it is now, not as it was before the prompt.
  const written = updateState(root, (fresh) => ({
    global_halt: false,
    workflow_paused: false,
    halt_override_consumed: false,  // re-arm one-shot for next episode
    halt_override_until: null,      // any time-boxed grant ends with the episode
    resume_ts: Date.now(),
    // Acknowledge the signals that caused the halt, not just the halt flag.
    // The kill-switch re-reads red-signals.jsonl on the next non-read tool call, and the
    // entries that tripped it are still inside the 30-minute lookback — so clearing
    // global_halt alone bought about nine minutes before the identical window re-halted.
    // Everything logged up to this instant has now been put in front of the user.
    red_signal_ack_ts: Date.now(),
    resume_log: [...(fresh.resume_log || []), {
      ts: Date.now(),
      cleared: reasons,
      previous_halt_reasons: fresh.halt_reasons || []
    }],
    // Clear halt fields
    halt_ts: null,
    halt_reasons: []
  }));

  if (!written) {
    return { success: false, message: 'Could not write workflow state — another writer holds it. Try again.' };
  }

  // Write resume log to metrics
  const metricsDir = path.join(root, '.bk-metrics');
  if (!fs.existsSync(metricsDir)) fs.mkdirSync(metricsDir, { recursive: true });
  const resumeLogFile = path.join(metricsDir, 'resume-log.jsonl');
  const resumeEntry = { ts: Date.now(), cleared: reasons, feature: state.feature || 'unknown' };
  fs.appendFileSync(resumeLogFile, JSON.stringify(resumeEntry) + '\n', 'utf8');

  return { success: true, message: `Workflow resumed. Cleared: ${reasons.join(', ')}.` };
}

/**
 * Reset phase recurrence and/or agent dispatch counts.
 *
 * Dispatch counts are keyed by feature, then by agent:
 * `{ [feature]: { [agent]: n } }`. Resetting one agent clears it in every feature — a user
 * reaching for this is unblocking themselves, not auditing, and asking which feature the
 * count belongs to would defeat the point.
 *
 * @param {{ projectRoot: string, force?: boolean, agent?: string, feature?: string }} opts
 * @returns {{ success: boolean, message: string }}
 */
async function resetCounts(opts = {}) {
  const root = resolveCliProjectRoot(opts.projectRoot);
  const state = readState(root);

  if (!state) {
    return { success: false, message: 'No workflow state found.' };
  }

  const targetAgent = opts.agent || null;
  const targetFeature = opts.feature || null;
  // The description names the history too, because that is what the cap actually decides on
  // — a user told only that "counts" were reset has no way to know the block will lift.
  const descr = targetAgent
    ? `agent dispatch count + history for "${targetAgent}"${targetFeature ? ` in feature "${targetFeature}"` : ' (all features)'}`
    : targetFeature
      ? `agent dispatch counts + history for feature "${targetFeature}"`
      : 'all phase_recurrence_count + agent_dispatch_count + agent_dispatch_history';

  if (!opts.force) {
    const confirmed = await askConfirm(`This will reset ${descr}. Confirm?`);
    if (!confirmed) {
      return { success: false, message: 'Reset cancelled by user.' };
    }
  }

  const written = updateState(root, (fresh) => buildCountReset(fresh, targetAgent, targetFeature));

  if (!written) {
    return { success: false, message: 'Could not write workflow state — another writer holds it. Try again.' };
  }

  return { success: true, message: `Reset complete: ${descr}.` };
}

/**
 * Prune the dispatch history the same way the counts are pruned.
 *
 * The cap hook decides from `agent_dispatch_history`, not from `agent_dispatch_count`, so a
 * reset that cleared only the tally left the block exactly where it was. That is not a
 * cosmetic gap: the block message prints this command as its own remedy, the field ran it,
 * and was denied again seconds later. The escape hatch has to touch what the decision reads.
 *
 * @param {Array} history
 * @param {string|null} targetAgent
 * @param {string|null} targetFeature
 * @returns {Array} rows to keep
 */
function pruneDispatchHistory(history, targetAgent, targetFeature) {
  if (!Array.isArray(history)) return [];
  // No target at all means "reset everything", which is the whole history.
  if (!targetAgent && !targetFeature) return [];
  return history.filter((row) => {
    if (!row || typeof row !== 'object') return false;
    // A row is dropped only when it matches every target that was given — `--agent X
    // --feature Y` must not also clear agent X's rows in other features.
    if (targetAgent && row.agent !== targetAgent) return true;
    if (targetFeature && (row.feature || 'unscoped') !== targetFeature) return true;
    return false;
  });
}

/**
 * Build the count-reset patch from the state as read under the write lock.
 *
 * @param {object} state - Fresh workflow state
 * @param {string|null} targetAgent
 * @param {string|null} targetFeature
 * @returns {object} Fields to merge
 */
function buildCountReset(state, targetAgent, targetFeature) {
  const updated = {};

  updated.agent_dispatch_history = pruneDispatchHistory(
    state.agent_dispatch_history, targetAgent, targetFeature);

  if (targetAgent || targetFeature) {
    const counts = state.agent_dispatch_count || {};
    // The pre-feature shape was `{ [agent]: number }`. It has no feature dimension, but it
    // is keyed by agent — so an --agent reset is still exactly expressible, and clearing
    // more than was asked for would throw away counts the caller wanted kept.
    const isLegacy = Object.values(counts).some((v) => typeof v === 'number');
    if (isLegacy) {
      const next = { ...counts };
      if (targetAgent) delete next[targetAgent];
      else next && Object.keys(next).forEach((k) => delete next[k]);
      updated.agent_dispatch_count = next;
    } else {
      const next = {};
      for (const [feature, agents] of Object.entries(counts)) {
        if (targetFeature && feature !== targetFeature) {
          next[feature] = agents;
          continue;
        }
        if (!targetAgent) continue;                 // whole feature cleared
        const remaining = { ...agents };
        delete remaining[targetAgent];
        if (Object.keys(remaining).length > 0) next[feature] = remaining;
      }
      updated.agent_dispatch_count = next;
    }
  } else {
    // Reset all
    updated.phase_recurrence_count = {};
    updated.agent_dispatch_count = {};
  }
  updated.counts_reset_ts = Date.now();
  return updated;
}

module.exports = { resumeWorkflow, resetCounts };
