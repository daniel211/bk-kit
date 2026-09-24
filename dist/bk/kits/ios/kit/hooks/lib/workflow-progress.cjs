/**
 * workflow-progress.cjs — how far the active plan has got, for the statusline.
 *
 * Once /bk-plan has laid out sub-tasks and /bk-code is working through them, the developer
 * wants one glance at the footer to answer "how much is done, what broke, how much is left".
 * The phase (`bk-code/coding`) says what kind of work is happening, not how far along it is.
 *
 * Progress is read from the plan on disk, never from Claude Tasks: tasks die with the
 * session and are skipped entirely for plans under three sub-tasks, while the plan files are
 * what bk-code syncs after every sub-task (checkboxes, frontmatter `status`, stepResults).
 *
 *   sub-task done    frontmatter `status: complete`, or stepResults[NN].status complete
 *   sub-task failed  frontmatter or stepResults status in FAILED_STATUSES (and not done)
 *   task done        `- [x]` under `## Tasks`; every task of a done sub-task counts as done
 *   task failed      an unchecked task inside a failed sub-task
 *
 * A legacy sub-task (no `## Tasks` section) counts as one task, as bk-code tracks it.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DONE_STATUSES = new Set(['complete', 'completed', 'done']);
const FAILED_STATUSES = new Set(['failed', 'blocked', 'escalated', 'needs_info', 'error']);
// Only an implementing workflow has progress to show: right after /bk-plan every counter
// reads 0/N, which is noise rather than information.
const PROGRESS_WORKFLOWS = new Set(['bk-code']);
// An aborted workflow's plan is abandoned — its half-finished counts are not "progress".
const HIDDEN_PHASES = new Set(['aborted']);
const SUB_TASK_FILE = /^sub-task-(\d+)[^/]*\.md$/;

/** Frontmatter `status:` of a sub-task file, lower-cased, or '' when absent. */
function readFrontmatterStatus(text) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!fm) return '';
  const m = /^status:\s*["']?([\w-]+)/m.exec(fm[1]);
  return m ? m[1].toLowerCase() : '';
}

/**
 * Checkbox counts under `## Tasks` only — checkboxes in other sections are acceptance
 * criteria or review questions, not work items (see bk-plan task-hydration.md).
 *
 * @returns {{checked: number, unchecked: number}|null} null when there is no `## Tasks`
 */
function countTaskCheckboxes(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+Tasks\s*$/.test(l));
  if (start < 0) return null;
  let checked = 0;
  let unchecked = 0;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,2}\s/.test(lines[i])) break; // next section
    if (/^\s*[-*]\s+\[[xX]\]/.test(lines[i])) checked++;
    else if (/^\s*[-*]\s+\[ \]/.test(lines[i])) unchecked++;
  }
  return { checked, unchecked };
}

/**
 * stepResults entries bk-code wrote for sub-tasks, keyed by sub-task number.
 * bk-plan's own planning steps share the object but carry no `subTask`, so they are ignored.
 */
function readSubTaskResults(planDir) {
  const byNumber = new Map();
  try {
    const planState = JSON.parse(fs.readFileSync(path.join(planDir, '.plan-state.json'), 'utf8'));
    const results = planState && planState.stepResults;
    if (!results || typeof results !== 'object') return byNumber;
    for (const entry of Object.values(results)) {
      if (!entry || entry.subTask === undefined || entry.subTask === null) continue;
      const num = parseInt(String(entry.subTask).replace(/\D/g, ''), 10);
      if (!Number.isNaN(num) && typeof entry.status === 'string') {
        byNumber.set(num, entry.status.toLowerCase());
      }
    }
  } catch { /* no plan state yet — frontmatter alone decides */ }
  return byNumber;
}

/**
 * @param {string} root — project root
 * @param {object|null} state — workflow state (`workflow_type`/`command`, `plan_dir`, `current_phase`,
 *   `batch`, `total_batches`)
 * @returns {{subTasks: {done: number, failed: number, total: number},
 *            tasks: {done: number, failed: number, total: number},
 *            batch: number|null, totalBatches: number|null}|null}
 *          null outside /bk-code, or when there is no active plan with sub-tasks
 */
function readWorkflowProgress(root, state) {
  try {
    if (!root || !state || typeof state.plan_dir !== 'string' || !state.plan_dir) return null;
    if (!PROGRESS_WORKFLOWS.has(state.workflow_type || state.command)) return null;
    if (HIDDEN_PHASES.has(state.current_phase)) return null;

    const planDir = path.resolve(root, state.plan_dir);
    const files = fs.readdirSync(planDir).filter((f) => SUB_TASK_FILE.test(f));
    if (files.length === 0) return null;

    const results = readSubTaskResults(planDir);
    const subTasks = { done: 0, failed: 0, total: 0 };
    const tasks = { done: 0, failed: 0, total: 0 };

    for (const file of files) {
      let text;
      try { text = fs.readFileSync(path.join(planDir, file), 'utf8'); } catch { continue; }
      const num = parseInt(SUB_TASK_FILE.exec(file)[1], 10);
      const fmStatus = readFrontmatterStatus(text);
      const resultStatus = results.get(num) || '';

      const done = DONE_STATUSES.has(fmStatus) || DONE_STATUSES.has(resultStatus);
      const failed = !done && (FAILED_STATUSES.has(fmStatus) || FAILED_STATUSES.has(resultStatus));

      subTasks.total++;
      if (done) subTasks.done++;
      else if (failed) subTasks.failed++;

      const boxes = countTaskCheckboxes(text) || { checked: done ? 1 : 0, unchecked: done ? 0 : 1 };
      const count = boxes.checked + boxes.unchecked;
      tasks.total += count;
      if (done) {
        tasks.done += count; // checkbox sync may lag the status write — the status wins
      } else {
        tasks.done += boxes.checked;
        if (failed) tasks.failed += boxes.unchecked;
      }
    }

    const asCount = (v) => (typeof v === 'number' && v > 0 ? v : null);
    return {
      subTasks,
      tasks,
      batch: asCount(state.batch),
      totalBatches: asCount(state.total_batches),
    };
  } catch {
    return null; // statusline is fail-open
  }
}

/**
 * Render progress for the statusline, e.g. `📋 sub 3/7 ✗1 · task 12/30 ✗2 · B2/4`.
 * The ✗ counts only appear when something failed.
 *
 * @param {ReturnType<typeof readWorkflowProgress>} progress
 * @param {{red: Function, green: Function}} colors
 * @returns {string} '' when there is nothing to show
 */
function renderWorkflowProgress(progress, colors) {
  if (!progress || progress.subTasks.total === 0) return '';
  const red = (colors && colors.red) || ((s) => s);
  const green = (colors && colors.green) || ((s) => s);

  const counter = (label, c) => {
    const text = `${label} ${c.done}/${c.total}`;
    const shown = c.total > 0 && c.done === c.total ? green(text) : text;
    return c.failed > 0 ? `${shown} ${red(`✗${c.failed}`)}` : shown;
  };

  const parts = [counter('sub', progress.subTasks)];
  if (progress.tasks.total > 0) parts.push(counter('task', progress.tasks));
  if (progress.batch && progress.totalBatches) {
    parts.push(`B${Math.min(progress.batch, progress.totalBatches)}/${progress.totalBatches}`);
  }
  return `📋 ${parts.join(' · ')}`;
}

module.exports = {
  readWorkflowProgress,
  renderWorkflowProgress,
  // exported for tests
  countTaskCheckboxes,
  readFrontmatterStatus,
  FAILED_STATUSES,
};
