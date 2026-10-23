/**
 * hook-budget.cjs — the one definition of how long a hook is allowed to take.
 *
 * Why this file exists: bk-dispatch.cjs capped every hook at 5000ms while
 * arch-fitness-*-native.cjs handed its child process a 30000ms budget from
 * `native_lint.timeout_ms`. The two numbers never met. In one day of field use
 * (fusionworkomni) the flutter hook ran 84 times, averaged 1076ms and burned
 * 90.4s — 97% of all PostToolUse hook time — and 4 of those runs were killed by
 * the dispatcher at exactly 5000/5001/5002ms. Those 4 runs' findings were lost
 * silently, because the hook still believed it had 25 more seconds.
 *
 * So: one module owns the budget, the dispatcher derives its cap from it, and a
 * hook that spawns a tool derives the tool's cap from it too.
 *
 * Exports:
 *   hookBudgetMs()            — the dispatcher's per-hook wall-clock cap
 *   toolBudgetMs(requestedMs) — the most a hook may give a child process
 */

'use strict';

/** Floor for a tool budget: below this a linter cannot even boot. */
const MIN_TOOL_BUDGET_MS = 1000;

/** Fraction of the hook budget a child process may consume, leaving room to report. */
const TOOL_BUDGET_FRACTION = 0.8;

/** Fallback when BK_HOOK_TIMEOUT_MS is unset or unparseable. */
const DEFAULT_HOOK_TIMEOUT_MS = 5000;

/**
 * Wall-clock budget one hook gets inside a dispatch. Overridable for slow machines.
 * @returns {number} milliseconds
 */
function hookBudgetMs() {
  return Number(process.env.BK_HOOK_TIMEOUT_MS) || DEFAULT_HOOK_TIMEOUT_MS;
}

/**
 * The timeout a hook may hand a child process it spawns.
 *
 * Always strictly under hookBudgetMs(), so the hook — not the dispatcher — is the
 * one that ends a slow tool, and can record the timeout before it exits.
 *
 * @param {number} [requestedMs] — what the policy asked for
 * @returns {number} milliseconds
 */
function toolBudgetMs(requestedMs) {
  const cap = Math.max(MIN_TOOL_BUDGET_MS, Math.floor(hookBudgetMs() * TOOL_BUDGET_FRACTION));
  const requested = Number(requestedMs);
  if (!Number.isFinite(requested) || requested <= 0) return cap;
  return Math.min(requested, cap);
}

module.exports = {
  DEFAULT_HOOK_TIMEOUT_MS,
  MIN_TOOL_BUDGET_MS,
  TOOL_BUDGET_FRACTION,
  hookBudgetMs,
  toolBudgetMs
};
