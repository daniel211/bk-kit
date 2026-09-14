/**
 * budget-guard.cjs — PreToolUse hook for subagent dispatches (Task / Agent).
 * Checks cumulative workflow cost against the session budget.
 *
 * Budget and behaviour come from the harness policy (`cost_budget`), which ships as
 * $20 with enforcement "warn". Warn is the default on purpose: a real bk-code workflow
 * costs ~$18, and the old hardcoded $2 hard block meant a single finished feature
 * permanently blocked every later dispatch in that repo.
 *
 *   enforcement "none"  → never fires
 *   enforcement "warn"  → advisory at the warn threshold and above; always exit 0
 *   enforcement "block" → advisory in the warn zone, exit 2 at the block threshold
 *                         (bypass with BK_BUDGET_OVERRIDE=1)
 *
 * Config resolution: policy.cost_budget → budget-config.json → hardcoded $20/0.80/0.95.
 * Fail-open throughout: if state/config/ledger is unreadable → exit 0.
 *
 * Cost source resolution (authoritative first, fallback second):
 *   1. Sum of subagent entries in cost-ledger.jsonl matching current workflowId
 *      — append-only, resilient to subagent-cost-capture silent failures
 *   2. state.cumulativeCostUsd from .workflow-state.json
 *      — maintained inline by subagent-cost-capture; may go stale on crash
 *   We use Math.max(ledger, state) so whichever sensor captured MORE wins.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { resolveProjectRoot } = require('./lib/resolve-project-root.cjs');
const { readWorkflowState, isHookEnabled } = require('./lib/bk-config-utils.cjs');
const { trackViolation, loadHarnessPolicy } = require('./lib/harness-policy-loader.cjs');
const { resolveMetricsDir } = require('./lib/cost-ledger-writer.cjs');
const { isAgentDispatch, getToolName } = require('./lib/hook-event-accessor.cjs');
const { resolveWorkflowId } = require('./lib/workflow-identity.cjs');

const FALLBACK_BUDGET_USD = 20.00;
const FALLBACK_WARN = 0.80;
const FALLBACK_BLOCK = 0.95;

/**
 * Sum subagent-type costUsd entries from cost-ledger.jsonl.
 * Filters by workflowId when provided — legacy entries without workflowId
 * are skipped (safer to undercount than to attribute across workflows).
 * Returns 0 if ledger missing / unreadable — caller treats as "no data".
 */
function readLedgerSum(workflowId) {
  try {
    const ledgerPath = path.join(resolveMetricsDir(), 'cost-ledger.jsonl');
    if (!fs.existsSync(ledgerPath)) return 0;
    const lines = fs.readFileSync(ledgerPath, 'utf8').split('\n');
    let sum = 0;
    for (const line of lines) {
      if (!line) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.type !== 'subagent' || typeof obj.costUsd !== 'number') continue;
        // resolveWorkflowId always yields a key, so this filter always applies.
        // Entries stamped with a different key — another feature, another command, or
        // the legacy raw-sessionId format — belong to someone else's tally. Skipping
        // them undercounts at worst; counting them was the lifetime-total bug.
        if (obj.workflowId !== workflowId) continue;
        sum += obj.costUsd;
      } catch { /* skip malformed line */ }
    }
    return sum;
  } catch {
    return 0;
  }
}

// Load budget config from env override → project path → shipped default
function loadBudgetConfig() {
  const candidates = [];

  // 1. Env override
  if (process.env.BK_BUDGET_CONFIG) {
    candidates.push(process.env.BK_BUDGET_CONFIG);
  }

  // 2. Project path
  try {
    const root = resolveProjectRoot();
    candidates.push(path.join(root, 'bk', 'dev', 'shared', 'budget-config.json'));
  } catch { /* skip */ }

  // 3. Hook's shipped default — check same dir and lib/ subdir
  candidates.push(path.join(__dirname, 'budget-config.json'));
  candidates.push(path.join(__dirname, 'lib', 'budget-config.json'));

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
      }
    } catch { /* try next */ }
  }
  return null;
}

/**
 * Resolve the effective budget settings.
 * Policy wins (that is the file users are told to edit — docs claimed this was already
 * true when it was not); budget-config.json is a fallback for kits without a policy.
 * @returns {{limit:number, warn:number, block:number, enforcement:string}|null}
 *   null means "disabled — stay silent".
 */
function resolveBudgetSettings() {
  let policyBudget = null;
  try {
    const policy = loadHarnessPolicy();
    if (policy && policy.cost_budget && typeof policy.cost_budget === 'object') {
      policyBudget = policy.cost_budget;
    }
  } catch { /* fall through to file config */ }

  if (policyBudget && policyBudget.enabled === false) return null;

  const cfg = loadBudgetConfig() || {};

  const limit = firstNumber(
    policyBudget && policyBudget.session_budget_usd,
    cfg.maxPerWorkflowUsd,
    FALLBACK_BUDGET_USD
  );
  const warn = firstNumber(cfg.warnThreshold, FALLBACK_WARN);
  const block = firstNumber(cfg.blockThreshold, FALLBACK_BLOCK);

  const rawMode = policyBudget && policyBudget.enforcement;
  const enforcement = ['warn', 'block', 'none'].includes(rawMode) ? rawMode : 'warn';

  return { limit, warn, block, enforcement };
}

/** First finite number in the list. */
function firstNumber(...values) {
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return 0;
}

// Emit advisory via stdout JSON (additionalContext for Claude)
function emitAdvisory(msg) {
  try {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: msg
      }
    }) + '\n');
  } catch { /* ignore */ }
}

// Read and parse stdin JSON (hook input)
// Uses fd 0 — works across shell pipes AND Node-spawned subprocess pipes
// ('/dev/stdin' fails with ENXIO in the latter).
function readStdinJson() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function main() {
  const hookInput = readStdinJson();

  // Only act on subagent dispatches (Task / Agent)
  if (!isAgentDispatch(hookInput)) {
    process.exit(0);
  }

  // Respect `.bk.json` — fail-open if the config is unreadable.
  try {
    if (!isHookEnabled('budget-guard')) {
      process.exit(0);
    }
  } catch { /* unreadable config → keep guarding */ }

  const settings = resolveBudgetSettings();
  if (!settings) {
    // cost_budget.enabled === false
    process.exit(0);
  }
  if (settings.enforcement === 'none') {
    process.exit(0);
  }

  const maxPerWorkflow = settings.limit;
  const warnThreshold = settings.warn;
  const blockThreshold = settings.block;

  // Load workflow state — fail-open if corrupt/missing
  let state = null;
  try {
    state = readWorkflowState();
  } catch { /* fail-open */ }

  if (!state || typeof state !== 'object') {
    // State may not exist yet (fresh workflow before first subagent runs) —
    // still try the ledger sum before giving up.
    state = {};
  }

  const stateCost = typeof state.cumulativeCostUsd === 'number' ? state.cumulativeCostUsd : 0;
  // Derive the ledger key exactly the way subagent-cost-capture stamps it, so the filter
  // below actually matches this workflow's entries and nobody else's.
  const sessionId = hookInput.session_id || hookInput.sessionId || null;
  const workflowId = resolveWorkflowId(state, sessionId);
  const ledgerCost = readLedgerSum(workflowId);

  // Ledger is the authoritative source (append-only, survives hook crashes).
  // State is the fast-path fallback. Take whichever is larger — underestimating
  // budget is the dangerous direction.
  const cumulativeCost = Math.max(stateCost, ledgerCost);

  // If both sources returned 0 and we had no state file at all, stay silent —
  // this is normal for the first spawn of a fresh workflow.
  if (cumulativeCost === 0 && !('cumulativeCostUsd' in state)) {
    process.exit(0);
  }

  // Compute ratio against workflow budget
  const ratio = maxPerWorkflow > 0 ? (cumulativeCost / maxPerWorkflow) : 0;

  // Under warn threshold → silent pass
  if (ratio < warnThreshold) {
    process.exit(0);
  }

  const pct = Math.round(ratio * 100);
  const spent = cumulativeCost.toFixed(4);

  // Warn zone (between warn and block threshold) — advisory under every enforcement mode.
  if (ratio < blockThreshold) {
    emitAdvisory(warnMessage(pct, spent, maxPerWorkflow, settings.enforcement));
    process.exit(0);
  }

  // Block zone — what happens here is the only thing enforcement changes.
  if (settings.enforcement !== 'block') {
    emitAdvisory([
      `BUDGET EXCEEDED: ${pct}% of $${maxPerWorkflow.toFixed(2)} workflow budget used ($${spent}).`,
      `Dispatches are not blocked (cost_budget.enforcement = "warn").`,
      `Consider downgrading effort, or set cost_budget.enforcement = "block" in`,
      `.claude/bk-harness-policy.json to stop dispatches at this point.`
    ].join('\n'));
    process.exit(0);
  }

  if (process.env.BK_BUDGET_OVERRIDE === '1') {
    // User explicitly overrides — silent pass
    process.exit(0);
  }

  // Hard block
  process.stderr.write(
    `BUDGET CRITICAL: ${pct}% of $${maxPerWorkflow.toFixed(2)} workflow budget used ($${spent}).\n` +
    `Task spawn blocked to prevent runaway costs.\n` +
    `To override: set BK_BUDGET_OVERRIDE=1 and retry.\n`
  );
  trackViolation({
    hook: 'budget-guard',
    violation_type: 'budget_exceeded',
    tool: getToolName(hookInput) || 'Agent',
    blocked: true,
    severity: 'error',
    context: { pct, spent, max: maxPerWorkflow }
  });
  process.exit(2);
}

/** Advisory text for the warn zone. */
function warnMessage(pct, spent, maxPerWorkflow, enforcement) {
  const lines = [
    `BUDGET WARN: ${pct}% of $${maxPerWorkflow.toFixed(2)} workflow budget used ($${spent}).`,
    `Recommended effort downgrade for remaining Task() spawns:`,
    `  xhigh → high`,
    `  high  → medium`,
    `  max   → xhigh`
  ];
  if (enforcement === 'block') {
    lines.push(`To override budget block: set env BK_BUDGET_OVERRIDE=1 and retry.`);
  }
  return lines.join('\n');
}

main();
