/**
 * workflow-progress.cjs — how far the active plan has got, for the statusline.
 *
 * Once /bk-plan has laid out sub-tasks and /bk-code is working through them, the developer
 * wants one glance at the footer to answer "how much is done, what broke, how much is left".
 * The phase (`bk-code/coding`) says what kind of work is happening, not how far along it is.
 *
 * Progress is read from the plan on disk, never from Claude Tasks: tasks die with the
 * session and are skipped entirely for plans under three sub-tasks, while the plan files are
 * what bk-code syncs after every sub-task. A sub-task's status comes from any of three places
 * bk-code writes, and older plans may only have one of them:
 *
 *   1. sub-task frontmatter `status:` (legacy plans: `blocked: yes`)
 *   2. `.plan-state.json` stepResults[NN].status
 *   3. plan.md tables — see plan-table-status.cjs
 *
 * If any source says done, it is done; else failed; else blocked. Blocked is not failed: it
 * is waiting on a decision or another sub-task, and is shown apart (⏸) from failures (✗).
 *
 * Tasks are the `## Tasks` checkboxes. The task counter is shown only when every sub-task has
 * that section — for a pre-0.6.0 plan any task figure would be invented.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { readPlanTableStatuses, normalizeSubTaskId, statusCategory } = require('./plan-table-status.cjs');

// Only an implementing workflow has progress to show: right after /bk-plan every counter
// reads 0/N, which is noise rather than information.
const PROGRESS_WORKFLOWS = new Set(['bk-code']);
// An aborted workflow's plan is abandoned — its half-finished counts are not "progress".
const HIDDEN_PHASES = new Set(['aborted']);
const SUB_TASK_FILE = /^sub-task-(\d+[a-z]?)(?:-[^/]*)?\.md$/i;

/** Frontmatter of a sub-task file as a key → raw value map (top-level scalars only). */
function readFrontmatter(text) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const fields = {};
  if (!fm) return fields;
  for (const m of fm[1].matchAll(/^([\w-]+):\s*["']?([^"'\r\n]*)/gm)) fields[m[1].toLowerCase()] = m[2].trim();
  return fields;
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
 * stepResults categories bk-code wrote for sub-tasks, keyed by normalized sub-task id.
 * bk-plan's own planning steps share the object but carry no `subTask`, so they are ignored.
 */
function readStepResultStatuses(planDir) {
  const byId = new Map();
  try {
    const planState = JSON.parse(fs.readFileSync(path.join(planDir, '.plan-state.json'), 'utf8'));
    const results = planState && planState.stepResults;
    if (!results || typeof results !== 'object') return byId;
    for (const entry of Object.values(results)) {
      if (!entry || entry.subTask === undefined || entry.subTask === null) continue;
      const id = normalizeSubTaskId(String(entry.subTask).replace(/^sub-task-/i, ''));
      const category = statusCategory(entry.status);
      if (id && category) byId.set(id, category);
    }
  } catch { /* no plan state yet */ }
  return byId;
}

/** 'done' | 'failed' | 'blocked' | null, from every source that mentions this sub-task. */
function resolveSubTaskState(categories) {
  if (categories.has('done')) return 'done';
  if (categories.has('failed')) return 'failed';
  if (categories.has('blocked')) return 'blocked';
  return null;
}

/**
 * @param {string} root — project root
 * @param {object|null} state — workflow state (`workflow_type`/`command`, `plan_dir`, `current_phase`,
 *   `batch`, `total_batches`)
 * @returns {{subTasks: {done: number, failed: number, blocked: number, total: number},
 *            tasks: {done: number, failed: number, total: number}|null,
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

    const stepResults = readStepResultStatuses(planDir);
    const tableStatuses = readPlanTableStatuses(planDir);
    const subTasks = { done: 0, failed: 0, blocked: 0, total: 0 };
    const tasks = { done: 0, failed: 0, total: 0 };
    let everyHasTasks = true;

    for (const file of files) {
      let text;
      try { text = fs.readFileSync(path.join(planDir, file), 'utf8'); } catch { continue; }
      const id = normalizeSubTaskId(SUB_TASK_FILE.exec(file)[1]);
      const fm = readFrontmatter(text);

      const categories = new Set(tableStatuses.get(id) || []);
      const fmCategory = statusCategory(fm.status);
      if (fmCategory) categories.add(fmCategory);
      if (stepResults.has(id)) categories.add(stepResults.get(id));
      if (/^(yes|true)\b/i.test(fm.blocked || '')) categories.add('blocked');
      const subState = resolveSubTaskState(categories);

      subTasks.total++;
      if (subState) subTasks[subState]++;

      const boxes = countTaskCheckboxes(text);
      if (!boxes) { everyHasTasks = false; continue; }
      const count = boxes.checked + boxes.unchecked;
      tasks.total += count;
      if (subState === 'done') {
        tasks.done += count; // checkbox sync may lag the status write — the status wins
      } else {
        tasks.done += boxes.checked;
        if (subState === 'failed') tasks.failed += boxes.unchecked;
      }
    }

    const asCount = (v) => (typeof v === 'number' && v > 0 ? v : null);
    return {
      subTasks,
      tasks: everyHasTasks ? tasks : null,
      batch: asCount(state.batch),
      totalBatches: asCount(state.total_batches),
    };
  } catch {
    return null; // statusline is fail-open
  }
}

/**
 * Render progress for the statusline, e.g. `📋 sub 3/7 ✗1 ⏸1 · task 12/30 ✗2 · B2/4`.
 * ✗ (failed) and ⏸ (blocked) only appear when non-zero.
 *
 * @param {ReturnType<typeof readWorkflowProgress>} progress
 * @param {{red?: Function, green?: Function, yellow?: Function}} [colors]
 * @returns {string} '' when there is nothing to show
 */
function renderWorkflowProgress(progress, colors) {
  if (!progress || progress.subTasks.total === 0) return '';
  const plain = (s) => s;
  const red = (colors && colors.red) || plain;
  const green = (colors && colors.green) || plain;
  const yellow = (colors && colors.yellow) || plain;

  const counter = (label, c) => {
    const text = `${label} ${c.done}/${c.total}`;
    let shown = c.total > 0 && c.done === c.total ? green(text) : text;
    if (c.failed > 0) shown += ` ${red(`✗${c.failed}`)}`;
    if (c.blocked > 0) shown += ` ${yellow(`⏸${c.blocked}`)}`;
    return shown;
  };

  const parts = [counter('sub', progress.subTasks)];
  if (progress.tasks && progress.tasks.total > 0) parts.push(counter('task', progress.tasks));
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
};
