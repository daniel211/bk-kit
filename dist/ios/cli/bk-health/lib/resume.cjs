'use strict';
/**
 * resume.cjs — Resume a paused/halted workflow or reset dispatch counts.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

function readJson(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

function writeJson(filePath, obj) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf8');
}

function getStateFile(projectRoot) {
  return path.join(projectRoot, 'mk', 'dev', 'shared', '.workflow-state.json');
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
  const root = opts.projectRoot || process.env.BK_PROJECT_ROOT || process.cwd();
  const stateFile = getStateFile(root);
  const state = readJson(stateFile);

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

  // Update state
  const updated = { ...state };
  updated.global_halt = false;
  updated.workflow_paused = false;
  updated.halt_override_consumed = false;  // re-arm one-shot for next episode
  updated.resume_ts = Date.now();
  updated.resume_log = [...(state.resume_log || []), {
    ts: Date.now(),
    cleared: reasons,
    previous_halt_reasons: state.halt_reasons || []
  }];
  // Clear halt fields
  delete updated.halt_ts;
  updated.halt_reasons = [];

  writeJson(stateFile, updated);

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
 * @param {{ projectRoot: string, force?: boolean, agent?: string }} opts
 * @returns {{ success: boolean, message: string }}
 */
async function resetCounts(opts = {}) {
  const root = opts.projectRoot || process.env.BK_PROJECT_ROOT || process.cwd();
  const stateFile = getStateFile(root);
  const state = readJson(stateFile);

  if (!state) {
    return { success: false, message: 'No workflow state found.' };
  }

  const targetAgent = opts.agent || null;
  const descr = targetAgent
    ? `agent dispatch count for "${targetAgent}"`
    : 'all phase_recurrence_count + agent_dispatch_count';

  if (!opts.force) {
    const confirmed = await askConfirm(`This will reset ${descr}. Confirm?`);
    if (!confirmed) {
      return { success: false, message: 'Reset cancelled by user.' };
    }
  }

  const updated = { ...state };

  if (targetAgent) {
    // Reset single agent
    if (updated.agent_dispatch_count) {
      updated.agent_dispatch_count = { ...updated.agent_dispatch_count };
      delete updated.agent_dispatch_count[targetAgent];
    }
  } else {
    // Reset all
    updated.phase_recurrence_count = {};
    updated.agent_dispatch_count = {};
  }
  updated.counts_reset_ts = Date.now();

  writeJson(stateFile, updated);

  return { success: true, message: `Reset complete: ${descr}.` };
}

module.exports = { resumeWorkflow, resetCounts };
