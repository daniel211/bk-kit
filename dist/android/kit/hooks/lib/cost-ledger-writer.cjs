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
 *   rawCost = (tokensIn/1000 * inputPer1k) + (tokensOut/1000 * outputPer1k)
 *   adjustedCost = rawCost * effortMultiplier
 *
 * Accuracy caveat: JSONL usage.input_tokens undercounts 46-174x due to thinking tokens.
 * Effort multiplier compensates but result is still ±15-30% approximation.
 */

'use strict';

const fs = require('fs');
const path = require('path');

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
  return aliases[model] || model;
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
 *                           cacheCreationTokens, thinkingTokens, effort })
 *           Cache-aware: cacheRead = 0.1× input rate, cacheCreation = 1.25× input rate,
 *           thinking billed at output rate.
 *
 * @returns {number} Estimated cost in USD
 */
function computeCost(modelOrOpts, tokensIn, tokensOut, effort) {
  // Detect call shape
  let model, rawInputTokens, cacheReadTokens, cacheCreationTokens, thinkingTokens, _effort;
  if (modelOrOpts && typeof modelOrOpts === 'object') {
    ({ model, rawInputTokens = 0, tokensOut = 0, cacheReadTokens = 0,
       cacheCreationTokens = 0, thinkingTokens = 0, effort: _effort } = modelOrOpts);
    tokensOut = modelOrOpts.tokensOut || 0;
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
    if (!modelPricing) return 0;
  }

  const multipliers = pricing.effortMultipliers || {};
  const multiplier = multipliers[_effort || 'medium'] ?? multipliers['medium'] ?? 1.0;

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

module.exports = { computeCost, appendEntry, resolveMetricsDir };
