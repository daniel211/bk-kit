/**
 * context-monitor.cjs — Advisory hook: monitors context usage and emits threshold messages.
 *
 * Event: UserPromptSubmit (lowest overhead — fires once per turn).
 * Scope: Only emits for complexity_tier in [complex, architectural].
 * Source: process.env.CLAUDE_CONTEXT_USAGE (integer %) or state.turnCount heuristic.
 * Fail-open: any error → exit 0 silently.
 */

'use strict';

const { readWorkflowState, isHookEnabled } = require('./lib/bk-config-utils.cjs');

const COMPLEX_TIERS = new Set(['complex', 'architectural', 'Complex', 'Architectural']);

function getContextPercent(state) {
  // Primary: env variable set by Claude runtime
  const envVal = process.env.CLAUDE_CONTEXT_USAGE;
  if (envVal !== undefined && envVal !== '') {
    const n = parseInt(envVal, 10);
    if (!isNaN(n)) return n;
  }
  // Fallback: rough heuristic from turnCount (not reliable, just advisory)
  // Assume 200-turn sessions; beyond 120 turns ≈ 60%+
  if (state && typeof state.turnCount === 'number') {
    const pct = Math.round((state.turnCount / 200) * 100);
    return Math.min(pct, 99);
  }
  return null;
}

function buildAdvisory(pct) {
  if (pct < 60) return null;
  if (pct < 75) return `INFO: context at ${pct}%`;
  if (pct < 85) return `WARN: context at ${pct}%. Consider /clear after current task.`;
  return `CRITICAL: context at ${pct}%. Handoff doc written. Please /clear.`;
}

async function main() {
  try {
    if (!isHookEnabled('context-monitor')) process.exit(0);

    const state = readWorkflowState();
    const tier = state && state.complexity_tier;
    if (!tier || !COMPLEX_TIERS.has(tier)) process.exit(0);

    const pct = getContextPercent(state);
    if (pct === null) process.exit(0);

    const advisory = buildAdvisory(pct);
    if (!advisory) process.exit(0);

    // Output as Claude hook additionalContext
    const result = { additionalContext: `[context-monitor] ${advisory}` };
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch {
    // Fail-open
  }
  process.exit(0);
}

main();
