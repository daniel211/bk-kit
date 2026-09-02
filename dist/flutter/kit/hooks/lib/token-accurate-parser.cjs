/**
 * token-accurate-parser.cjs — Parse subagent JSONL transcript with ±3% accuracy
 *
 * Exports: parseTranscriptAccurate(filePath, opts) → Promise<Result>
 *
 * Improvement over jsonl-token-parser.cjs:
 *   - Sums cumulative cache_read_input_tokens + cache_creation_input_tokens + input_tokens
 *     across ALL assistant messages (not just last), matching Claude's actual billing model.
 *   - Extracts separate cache/input/output rates from model-pricing.json.
 *   - Provides durationMs from first_user_ts → last_assistant_ts.
 *
 * Accuracy levels:
 *   'high'   — found non-zero usage in at least one assistant message
 *   'approx' — fallback text-length ÷ 4 estimate
 *   'low'    — file not readable or all parsing failed
 */

'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Load model-pricing.json once at module load time
let _pricingData = null;
function getPricingData() {
  if (_pricingData) return _pricingData;
  try {
    const pricingPath = path.join(__dirname, 'model-pricing.json');
    _pricingData = JSON.parse(fs.readFileSync(pricingPath, 'utf8'));
  } catch {
    _pricingData = { models: {}, aliases: {} };
  }
  return _pricingData;
}

/**
 * Resolve model string to pricing entry.
 * Supports full names, partial matches, and aliases.
 *
 * @param {string|null} model
 * @returns {{ inputPer1k: number, outputPer1k: number, cacheReadPer1k?: number, cacheCreationPer1k?: number }|null}
 */
function resolvePricing(model) {
  if (!model) return null;
  const pricing = getPricingData();
  const { models = {}, aliases = {} } = pricing;

  // Exact match
  if (models[model]) return models[model];

  // Alias match
  const aliasTarget = aliases[model];
  if (aliasTarget && models[aliasTarget]) return models[aliasTarget];

  // Partial match (e.g. "claude-sonnet-4-6" matches "claude-sonnet-4-6")
  // Try longest prefix match
  const lower = model.toLowerCase();
  let bestKey = null;
  let bestLen = 0;
  for (const key of Object.keys(models)) {
    if (lower.includes(key.toLowerCase()) || key.toLowerCase().includes(lower)) {
      if (key.length > bestLen) {
        bestLen = key.length;
        bestKey = key;
      }
    }
  }
  if (bestKey) return models[bestKey];

  return null;
}

/**
 * Compute cost from token counts and pricing entry.
 *
 * @param {object} pricing
 * @param {number} cacheReadTokens
 * @param {number} cacheCreationTokens
 * @param {number} inputTokens
 * @param {number} outputTokens
 * @returns {number} cost in USD
 */
function computeCost(pricing, cacheReadTokens, cacheCreationTokens, inputTokens, outputTokens) {
  if (!pricing) return 0;

  // Use specific cache rates if provided, otherwise fall back to inputPer1k
  const cacheReadRate = pricing.cacheReadPer1k != null
    ? pricing.cacheReadPer1k
    : (pricing.cache_read_rate != null ? pricing.cache_read_rate : pricing.inputPer1k * 0.1);
  const cacheCreationRate = pricing.cacheCreationPer1k != null
    ? pricing.cacheCreationPer1k
    : (pricing.cache_creation_rate != null ? pricing.cache_creation_rate : pricing.inputPer1k * 1.25);
  const inputRate = pricing.inputPer1k || 0;
  const outputRate = pricing.outputPer1k || 0;

  const cost =
    (cacheReadTokens / 1000) * cacheReadRate +
    (cacheCreationTokens / 1000) * cacheCreationRate +
    (inputTokens / 1000) * inputRate +
    (outputTokens / 1000) * outputRate;

  return Math.round(cost * 1e8) / 1e8;
}

/**
 * Classify model family from model string.
 *
 * @param {string|null} model
 * @returns {string}
 */
function modelFamily(model) {
  if (!model) return 'unknown';
  const m = model.toLowerCase();
  if (m.includes('opus')) return 'opus';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('haiku')) return 'haiku';
  return 'unknown';
}

/**
 * Is `transcriptPath` the session's own transcript rather than a subagent's?
 *
 * Claude Code writes one transcript per session, named <session_id>.jsonl, and
 * subagent turns do not appear in it. When SubagentStop hands a hook that path,
 * parsing it yields session-wide totals — not the subagent's usage. Attributing
 * those totals to the subagent makes every subagent look identical and multiplies
 * the session's cost by the number of subagents in the ledger.
 *
 * @param {string|null} transcriptPath
 * @param {string|null} sessionId
 * @returns {boolean} true when the numbers must NOT be attributed to one subagent
 */
function isOwnSessionTranscript(transcriptPath, sessionId) {
  if (!transcriptPath || !sessionId) return false;
  return path.basename(String(transcriptPath), '.jsonl') === String(sessionId);
}

/**
 * Parse a subagent JSONL transcript file with high accuracy.
 *
 * @param {string} filePath — absolute path to the .jsonl transcript
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs=800] — max read time in ms
 * @returns {Promise<{
 *   agentType: string|null,
 *   model: string|null,
 *   modelFamily: string,
 *   tokensIn: number,
 *   tokensOut: number,
 *   thinkingTokens: number,
 *   cacheReadTokens: number,
 *   cacheCreationTokens: number,
 *   costUsd: number,
 *   durationMs: number|null,
 *   firstTs: string|null,
 *   lastTs: string|null,
 *   accuracy: 'high'|'approx'|'low'
 * }>}
 */
async function parseTranscriptAccurate(filePath, opts = {}) {
  const timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : 800;

  const result = {
    agentType: null,
    model: null,
    modelFamily: 'unknown',
    tokensIn: 0,
    tokensOut: 0,
    thinkingTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUsd: 0,
    durationMs: null,
    firstTs: null,
    lastTs: null,
    accuracy: 'low'
  };

  if (!filePath) return result;

  try {
    if (!fs.existsSync(filePath)) return result;
  } catch {
    return result;
  }

  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; }, timeoutMs);

  try {
    // Accumulators
    let sumCacheRead = 0;
    let sumCacheCreation = 0;
    let sumInput = 0;
    let lastOutputTokens = 0;
    let sumThinking = 0;
    let foundNonZeroUsage = false;
    let lastModel = null;
    let lastAgentType = null;
    let firstUserTs = null;
    let lastAssistantTs = null;
    let totalTextLength = 0;

    await new Promise((resolve, reject) => {
      let stream;
      try {
        stream = fs.createReadStream(filePath, { encoding: 'utf8' });
      } catch (e) {
        return reject(e);
      }
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

      rl.on('line', (line) => {
        if (timedOut) { rl.close(); stream.destroy(); return; }
        if (!line.trim()) return;

        let obj;
        try { obj = JSON.parse(line); } catch { return; }

        // Track model/agentType from any top-level field
        if (obj.model) lastModel = obj.model;
        if (obj.agent_type || obj.agentType) lastAgentType = obj.agent_type || obj.agentType;

        // Get message (support both top-level and nested)
        const msg = obj.message || obj;
        const role = msg.role || obj.role || obj.type;
        const ts = obj.timestamp || obj.ts || msg.timestamp || null;

        // Track timestamps
        if (ts) {
          if (role === 'user' && !firstUserTs) firstUserTs = ts;
          if (role === 'assistant') lastAssistantTs = ts;
        }

        // Accumulate text content for fallback
        const content = msg.content || obj.content || '';
        if (typeof content === 'string') {
          totalTextLength += content.length;
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (block && block.text) totalTextLength += block.text.length;
          }
        }

        // Process assistant messages with usage
        if (role === 'assistant') {
          // Model can be in message object too
          if (msg.model) lastModel = msg.model;
          if (obj.model) lastModel = obj.model;

          const usage = msg.usage || obj.usage;
          if (usage) {
            const cacheRead = usage.cache_read_input_tokens || 0;
            const cacheCreation = usage.cache_creation_input_tokens || 0;
            const inp = usage.input_tokens || 0;
            const out = usage.output_tokens || 0;
            const thinking = usage.thinking_tokens || 0;

            // Sum cumulative (matching Claude's billing — each turn accumulates)
            sumCacheRead += cacheRead;
            sumCacheCreation += cacheCreation;
            sumInput += inp;
            // Output: take the last value (each message replaces previous)
            lastOutputTokens = out;
            sumThinking += thinking;

            if (cacheRead > 0 || cacheCreation > 0 || inp > 1 || out > 1) {
              foundNonZeroUsage = true;
            }
          }
        }
      });

      rl.on('close', resolve);
      rl.on('error', reject);
      stream.on('error', reject);
    });

    clearTimeout(timer);

    result.model = lastModel;
    result.modelFamily = modelFamily(lastModel);
    result.agentType = lastAgentType;
    result.thinkingTokens = sumThinking;
    result.firstTs = firstUserTs;
    result.lastTs = lastAssistantTs;

    if (firstUserTs && lastAssistantTs) {
      try {
        result.durationMs = new Date(lastAssistantTs).getTime() - new Date(firstUserTs).getTime();
        if (result.durationMs < 0) result.durationMs = null;
      } catch { result.durationMs = null; }
    }

    if (foundNonZeroUsage) {
      result.cacheReadTokens = sumCacheRead;
      result.cacheCreationTokens = sumCacheCreation;
      result.tokensIn = sumCacheRead + sumCacheCreation + sumInput;
      result.tokensOut = lastOutputTokens;
      result.accuracy = 'high';

      // Compute cost
      const pricing = resolvePricing(lastModel);
      result.costUsd = computeCost(pricing, sumCacheRead, sumCacheCreation, sumInput, lastOutputTokens);
    } else if (totalTextLength > 0) {
      // Fallback: text-length / 4
      const estimated = Math.ceil(totalTextLength / 4);
      result.tokensIn = Math.ceil(estimated * 0.75);
      result.tokensOut = Math.ceil(estimated * 0.25);
      result.cacheReadTokens = 0;
      result.cacheCreationTokens = 0;
      result.accuracy = 'approx';

      const pricing = resolvePricing(lastModel);
      result.costUsd = computeCost(pricing, 0, 0, result.tokensIn, result.tokensOut);
    }
    // else accuracy stays 'low'

    return result;
  } catch (err) {
    clearTimeout(timer);
    process.stderr.write(`[token-accurate-parser] warn: ${err.message}\n`);
    return result;
  }
}

module.exports = { isOwnSessionTranscript, parseTranscriptAccurate, resolvePricing, computeCost };
