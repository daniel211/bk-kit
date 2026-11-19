/**
 * current-plan.cjs — which plan.md did the planner that just finished write?
 *
 * complexity-detector and plan-complete-reminder both answered with the reverse-alphabetical
 * first directory under bk/dev/ that holds a plan.md. In X-Game-Pro on 2026-09-23 a bk-planner
 * finished at 08:53Z having written bk/dev/crypto-module/plan.md at 08:51Z; both hooks reported
 * bk/dev/ios-project-init/plan.md ("i" sorts after "c"), and complexity-detector wrote that
 * other plan's tier — Complex, 9 sub-tasks, against crypto-module's 5 — into workflow state.
 * Workflow state's `plan_dir` was no better: it still read bk/dev/ios-project-init.
 *
 * The planner has just written its plan, so the most recently modified plan.md is the one it
 * wrote. That is the answer here; `plan_dir` is only the fallback when no plan.md exists yet
 * under bk/dev/ at all.
 */

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * @param {string} root — project root
 * @param {object|null} [state] — workflow state, for the plan_dir fallback
 * @returns {string|null} absolute path of plan.md, or null
 */
function currentPlanFile(root, state) {
  const devDir = path.join(root, 'bk', 'dev');
  let newest = null;
  try {
    for (const dir of fs.readdirSync(devDir)) {
      if (dir.startsWith('.') || dir === 'shared' || dir === 'reports') continue;
      const candidate = path.join(devDir, dir, 'plan.md');
      try {
        const mtimeMs = fs.statSync(candidate).mtimeMs;
        if (!newest || mtimeMs > newest.mtimeMs) newest = { file: candidate, mtimeMs };
      } catch { /* no plan here */ }
    }
  } catch { /* no bk/dev yet */ }
  if (newest) return newest.file;

  if (state && typeof state.plan_dir === 'string' && state.plan_dir) {
    const fromState = path.join(path.resolve(root, state.plan_dir), 'plan.md');
    if (fs.existsSync(fromState)) return fromState;
  }
  return null;
}

/**
 * The plan directory of the workflow in `state`, as a project-relative path — for the
 * `Plan:` line prompt-context-inject shows the conductor on every prompt.
 *
 * That line used to be the reverse-alphabetical first directory under bk/dev/, with no regard
 * for the workflow at all. In X-Game-Pro (0.12.x) it read `Plan: bk/dev/tracking-background/`
 * on the very line that said `Feature: quick-session-create` ("t" sorts after "q"), for a whole
 * feature. So the answer now follows the workflow state:
 *   1. `plan_dir`, when it exists and agrees with `feature` (or no feature is named);
 *   2. bk/dev/<feature>, when it exists — a stale plan_dir must not beat the feature on the
 *      same line (plan_dir lagged a feature before; see the header);
 *   3. `plan_dir` as written, when it exists;
 *   4. only with no workflow identity at all, the newest plan.md on disk.
 * Null when none of that exists — no line beats a wrong line.
 *
 * @param {string} root
 * @param {object|null} state
 * @returns {string|null} e.g. "bk/dev/quick-session-create"
 */
function currentPlanDir(root, state) {
  const s = state && typeof state === 'object' ? state : {};
  const rel = (abs) => path.relative(root, abs).split(path.sep).join('/');
  const isDir = (abs) => { try { return fs.statSync(abs).isDirectory(); } catch { return false; } };

  const planDir = typeof s.plan_dir === 'string' && s.plan_dir ? path.resolve(root, s.plan_dir) : null;
  const feature = typeof s.feature === 'string' && s.feature ? s.feature : null;

  if (planDir && isDir(planDir) && (!feature || path.basename(planDir) === feature)) return rel(planDir);
  if (feature && !/[\\/]/.test(feature)) {
    const featureDir = path.join(root, 'bk', 'dev', feature);
    if (isDir(featureDir)) return rel(featureDir);
  }
  if (planDir && isDir(planDir)) return rel(planDir);
  if (!feature && !planDir) {
    const newest = currentPlanFile(root, null);
    if (newest) return rel(path.dirname(newest));
  }
  return null;
}

module.exports = { currentPlanFile, currentPlanDir };
