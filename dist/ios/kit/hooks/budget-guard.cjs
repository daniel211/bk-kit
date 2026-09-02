/**
 * budget-guard.cjs — PreToolUse hook for Task spawns.
 * Checks cumulative workflow cost against budget thresholds.
 * Emits advisory at 80%; blocks at 95% (unless BK_BUDGET_OVERRIDE=1).
 * Fail-open: if state/config unreadable → exit 0 with warning.
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
const { readWorkflowState } = require('./lib/bk-config-utils.cjs');
const { trackViolation } = require('./lib/harness-policy-loader.cjs');
const { resolveMetricsDir } = require('./lib/cost-ledger-writer.cjs');

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
        // When a workflowId is known, only count entries for this workflow.
        // When it's null (fresh session), count all subagent entries —
        // consistent with fail-open spirit, err on side of stricter budget.
        if (workflowId != null && obj.workflowId !== workflowId) continue;
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
    candidates.push(path.join(root, 'mk', 'dev', 'shared', 'budget-config.json'));
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

// Today as YYYY-MM-DD
function todayDate() {
  return new Date().toISOString().slice(0, 10);
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
// ('/dev/stdin' fails with ENXIO trong the latter).
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

  // Only act on Task tool
  if (hookInput.tool_name !== 'Task') {
    process.exit(0);
  }

  // Load budget config — fail-open if missing
  const cfg = loadBudgetConfig();
  if (!cfg) {
    process.stderr.write('[budget-guard] WARN: budget-config.json not found, skipping budget check\n');
    process.exit(0);
  }

  const maxPerWorkflow = typeof cfg.maxPerWorkflowUsd === 'number' ? cfg.maxPerWorkflowUsd : 2.00;
  const warnThreshold = typeof cfg.warnThreshold === 'number' ? cfg.warnThreshold : 0.80;
  const blockThreshold = typeof cfg.blockThreshold === 'number' ? cfg.blockThreshold : 0.95;

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
  const workflowId = state.workflowId || state.workflow_id || null;
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

  // Daily reset check (informational — we track workflow budget primarily)
  const today = todayDate();
  if (state.lastBudgetDate !== today) {
    // State has stale date — todaySpent effectively resets (we note it but don't write state here)
    // Budget guard is read-only on state to stay fast and avoid lock contention
  }

  // Compute ratio against workflow budget
  const ratio = maxPerWorkflow > 0 ? (cumulativeCost / maxPerWorkflow) : 0;

  // Under warn threshold → silent pass
  if (ratio < warnThreshold) {
    process.exit(0);
  }

  const pct = Math.round(ratio * 100);
  const spent = cumulativeCost.toFixed(4);

  // Warn zone (80–95%)
  if (ratio >= warnThreshold && ratio < blockThreshold) {
    const advisory = [
      `BUDGET WARN: ${pct}% of $${maxPerWorkflow.toFixed(2)} workflow budget used ($${spent}).`,
      `Recommended effort downgrade for remaining Task() spawns:`,
      `  xhigh → high`,
      `  high  → medium`,
      `  max   → xhigh`,
      `To override budget block: set env BK_BUDGET_OVERRIDE=1 and retry.`
    ].join('\n');
    emitAdvisory(advisory);
    process.exit(0);
  }

  // Block zone (>= 95%)
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
  trackViolation({ hook: 'budget-guard', violation_type: 'budget_exceeded', tool: 'Task', blocked: true, severity: 'error', context: { pct, spent, max: maxPerWorkflow } });
  process.exit(2);
}

main();
