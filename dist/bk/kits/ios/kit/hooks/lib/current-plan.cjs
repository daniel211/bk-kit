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

module.exports = { currentPlanFile };
