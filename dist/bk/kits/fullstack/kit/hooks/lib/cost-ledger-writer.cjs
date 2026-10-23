/**
 * cost-ledger-writer.cjs - Compute API cost and append to cost ledger
 *
 * Exports:
 *   computeCost(model, tokensIn, tokensOut, effort) → number (USD)
 *   appendEntry(entry) → void
 *
 * Ledger location: {projectRoot}/.bk-metrics/cost-ledger.jsonl
 *   Override via BK_METRICS_DIR env var (for testing).
 *
 * Cost formula:
 *   rawCost = raw*inputRate + out*outputRate + cacheRead*0.1*inputRate
 *             + cacheCreation*1.25*inputRate + thinking*outputRate
 *   cost    = rawCost * effortMultiplier   ONLY when usage is not exact (see below)
 *
 * Effort multiplier: designed for the era when JSONL input_tokens were placeholders that
 * undercounted 46-174x (thinking tokens), where it compensated to a ±15-30% approximation.
 * Captured usage is now exact (token-accurate-parser sums every turn: accuracy 'high'), so
 * callers pass `exactUsage: true` and the multiplier is NOT applied — applying it was a flat
 * 1.5x over-count versus subagent-live-tracker's cost_usd. Legacy-signature calls and
 * granular calls without `exactUsage` (estimated / unknown-quality usage) keep the multiplier.
 * Historical ledger rows are not rewritten.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Models already reported as unknown by this process (violation dedupe, see computeCost).
const _reportedUnknown = new Set();

// Load pricing table once at module load time
let _pricing = null;
function getPricing() {
  if (_pricing) return _pricing;
  try {
    const pricingPath = path.join(__dirname, 'model-pricing.json');
    _pricing = JSON.parse(fs.readFileSync(pricingPath, 'utf8'));
  } catch (err) {
    process.stderr.write(`[cost-ledger-writer] warn: could not load model-pricing.json: ${err.message}\n`);
    _pricing = { models: {}, effortMultipliers: {}, aliases: {} };
  }
  return _pricing;
}

/**
 * Resolve model name via aliases.
 * @param {string} model
 * @returns {string}
 */
function resolveModel(model) {
  const pricing = getPricing();
  const aliases = pricing.aliases || {};
  const resolved = aliases[model] || model;
  const models = pricing.models || {};
  if (models[resolved] || typeof resolved !== 'string') return resolved;
  // A new point release (claude-opus-5-5, or a dated suffix) has no table entry yet: fall back
  // to the longest known model id that prefixes it on a `-` boundary, before giving up.
  let best = null;
  for (const key of Object.keys(models)) {
    if (key === 'unknown') continue;
    if (resolved.startsWith(`${key}-`) && (!best || key.length > best.length)) best = key;
  }
  return best || resolved;
}

/** True the first time this (model, session) is seen; fail-open (speak) on any error. */
function firstUnknownInSession(model, sessionId) {
  try {
    return require('./advisory-once.cjs').firstTime(`unknown_model|${model}`, { sessionId, feature: 'cost-ledger-writer' });
  } catch { return true; }
}

/**
 * Does `model` have a real price (exact, alias, or `-` prefix match), or would computeCost
 * fall back to the 'unknown' entry (which is the OPUS rate - ~50x too high for haiku-5-5)?
 * Ledger writers stamp `pricing: 'fallback'` and downgrade accuracy when this says fallback.
 * @param {string} model
 * @returns {{ source: 'table'|'fallback', resolvedModel: string }}
 */
function pricingSource(model) {
  const resolvedModel = resolveModel(model);
  const known = !!getPricing().models?.[resolvedModel];
  return { source: known ? 'table' : 'fallback', resolvedModel };
}

/**
 * Accuracy to record: a fallback-priced row is never better than 'approx', whatever the
 * token counts' accuracy, because the rate itself is a guess.
 * @param {string} accuracy
 * @param {string} model
 * @returns {string}
 */
function ledgerAccuracy(accuracy, model) {
  if (accuracy === 'high' && pricingSource(model).source === 'fallback') return 'approx';
  return accuracy;
}

/**
 * The estimate-compensation multiplier for an effort level (1.0 when unknown/unconfigured).
 * Single source for computeCost and for the `multiplierApplied` ledger field.
 * @param {string} [effort]
 * @returns {number}
 */
function effortMultiplier(effort) {
  const multipliers = getPricing().effortMultipliers || {};
  return multipliers[effort || 'medium'] ?? multipliers['medium'] ?? 1.0;
}

/**
 * Compute estimated cost in USD.
 *
 * Two call shapes supported (P1-4 cache-aware refactor, additive — old signature still works):
 *
 *   Legacy: computeCost(model, tokensIn, tokensOut, effort)
 *           Treats tokensIn as raw input. Use when caller has no cache breakdown.
 *
 *   Granular: computeCost({ model, rawInputTokens, tokensOut, cacheReadTokens,
 *                           cacheCreationTokens, thinkingTokens, effort, exactUsage })
 *           Cache-aware: cacheRead = 0.1× input rate, cacheCreation = 1.25× input rate,
 *           thinking billed at output rate.
 *           `exactUsage: true` (counts come from real usage, accuracy 'high') skips the
 *           effort multiplier; omit it for estimated usage.
 *
 * @returns {number} Estimated cost in USD
 */
function computeCost(modelOrOpts, tokensIn, tokensOut, effort) {
  // Detect call shape
  let model, rawInputTokens, cacheReadTokens, cacheCreationTokens, thinkingTokens, _effort;
  let exactUsage = false;
  let sessionId = null;
  if (modelOrOpts && typeof modelOrOpts === 'object') {
    ({ model, rawInputTokens = 0, tokensOut = 0, cacheReadTokens = 0,
       cacheCreationTokens = 0, thinkingTokens = 0, effort: _effort } = modelOrOpts);
    tokensOut = modelOrOpts.tokensOut || 0;
    exactUsage = modelOrOpts.exactUsage === true;
    sessionId = modelOrOpts.sessionId || null;
    // Backward compat: if caller passes legacy `tokensIn` (total) instead of `rawInputTokens`,
    // derive raw from total minus cache.
    if (rawInputTokens === 0 && typeof modelOrOpts.tokensIn === 'number') {
      rawInputTokens = Math.max(0, modelOrOpts.tokensIn - cacheReadTokens - cacheCreationTokens);
    }
  } else {
    model = modelOrOpts;
    rawInputTokens = tokensIn || 0;
    cacheReadTokens = 0;
    cacheCreationTokens = 0;
    thinkingTokens = 0;
    _effort = effort;
  }

  const pricing = getPricing();
  const resolvedModel = resolveModel(model);
  let modelPricing = pricing.models?.[resolvedModel];

  if (!modelPricing) {
    modelPricing = pricing.models?.unknown;
    // Once per (model, session): a subagent-heavy session otherwise filed one per ledger row
    // (X-Game-Pro 0.13.6: 200+). Without a session id, once per process.
    if (!_reportedUnknown.has(String(model)) && firstUnknownInSession(model, sessionId)) {
      _reportedUnknown.add(String(model));
      process.stderr.write(`[cost-ledger-writer] warn: no pricing for model '${model}' (resolved: '${resolvedModel}') — using 'unknown' fallback\n`);
      try {
        const { trackViolation } = require('./harness-policy-loader.cjs');
        trackViolation({
          hook: 'cost-ledger-writer',
          violation_type: 'unknown_model',
          severity: 'nudge',
          blocked: false,
          context: { model, resolvedModel }
        });
      } catch { /* loader unavailable */ }
    }
    if (!modelPricing) return 0;
  }

  // Exact usage already includes thinking/cache; the multiplier only compensates estimates.
  const multiplier = exactUsage ? 1.0 : effortMultiplier(_effort);

  const inputRate = modelPricing.inputPer1k;
  const outputRate = modelPricing.outputPer1k;
  // Anthropic standard: cacheRead = 0.1× input, cacheCreation = 1.25× input (override per model if specified)
  const cacheReadRate = modelPricing.cacheReadPer1k ?? inputRate * 0.1;
  const cacheCreateRate = modelPricing.cacheCreationPer1k ?? inputRate * 1.25;

  const rawCost = (rawInputTokens / 1000) * inputRate
                + (tokensOut / 1000) * outputRate
                + (cacheReadTokens / 1000) * cacheReadRate
                + (cacheCreationTokens / 1000) * cacheCreateRate
                + (thinkingTokens / 1000) * outputRate;

  return rawCost * multiplier;
}

/**
 * Resolve the .bk-metrics directory path.
 * Respects BK_METRICS_DIR env override (for testing).
 * Falls back to {projectRoot}/.bk-metrics.
 * @returns {string}
 */
function resolveMetricsDir() {
  if (process.env.BK_METRICS_DIR) {
    return process.env.BK_METRICS_DIR;
  }
  try {
    const { resolveProjectRoot } = require('./resolve-project-root.cjs');
    return path.join(resolveProjectRoot(), '.bk-metrics');
  } catch {
    return path.join(process.cwd(), '.bk-metrics');
  }
}

/**
 * Atomically append a JSON entry to cost-ledger.jsonl.
 * Creates directory + file if missing.
 * @param {Object} entry - Ledger entry (no prompt content — numbers/metadata only)
 */
function appendEntry(entry) {
  try {
    const dir = resolveMetricsDir();
    fs.mkdirSync(dir, { recursive: true });
    const ledgerPath = path.join(dir, 'cost-ledger.jsonl');
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
    // appendFileSync is atomic for small writes on POSIX
    fs.appendFileSync(ledgerPath, line, { encoding: 'utf8', flag: 'a' });
  } catch (err) {
    process.stderr.write(`[cost-ledger-writer] warn: could not write ledger: ${err.message}\n`);
  }
}

module.exports = { computeCost, pricingSource, ledgerAccuracy, effortMultiplier, appendEntry, resolveMetricsDir, resolveModel };
