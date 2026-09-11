/**
 * jsonl-token-parser.cjs - Parse subagent JSONL transcript for token usage
 *
 * @deprecated Use `token-accurate-parser.cjs` (parseTranscriptAccurate) instead.
 * Reads only LAST assistant message — undercounts in multi-turn conversations.
 * Kept as proxy for any external consumers (e.g., package/ v1 tools); will be
 * removed in a follow-up after confirming zero callers.
 *
 * Exports: parseTranscript(filePath, opts) → { agentType, model, tokensIn, tokensOut, lastTimestamp, accuracy }
 */

'use strict';

const fs = require('fs');
const readline = require('readline');

/**
 * Parse a subagent JSONL transcript file for token usage stats.
 *
 * @param {string} filePath - Absolute path to .jsonl file
 * @param {Object} [opts]
 * @param {number} [opts.timeoutMs=500] - Max read time in ms
 * @returns {Promise<{agentType:string|null, model:string|null, tokensIn:number, tokensOut:number, lastTimestamp:string|null, accuracy:'high'|'approx'|'low'}>}
 */
async function parseTranscript(filePath, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 500;
  const result = {
    agentType: null,
    model: null,
    tokensIn: 0,
    tokensOut: 0,
    lastTimestamp: null,
    accuracy: 'low'
  };

  if (!filePath || !fs.existsSync(filePath)) {
    return result;
  }

  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; }, timeoutMs);

  try {
    // Accumulate lines to find last assistant message with usage
    const lines = [];
    let totalTextLength = 0;
    let lastModel = null;
    let lastTimestamp = null;
    let lastAgentType = null;

    await new Promise((resolve, reject) => {
      const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

      rl.on('line', (line) => {
        if (timedOut) { rl.close(); stream.destroy(); return; }
        if (!line.trim()) return;
        try {
          const obj = JSON.parse(line);
          lines.push(obj);

          // Track model/timestamp/agentType from any message
          if (obj.model) lastModel = obj.model;
          if (obj.timestamp || obj.ts) lastTimestamp = obj.timestamp || obj.ts;
          if (obj.agent_type || obj.agentType) lastAgentType = obj.agent_type || obj.agentType;

          // Accumulate text for fallback estimate
          const content = obj.content || obj.message?.content || '';
          if (typeof content === 'string') totalTextLength += content.length;
          else if (Array.isArray(content)) {
            for (const block of content) {
              if (block?.text) totalTextLength += block.text.length;
            }
          }
        } catch { /* skip malformed lines */ }
      });

      rl.on('close', resolve);
      rl.on('error', reject);
      stream.on('error', reject);
    });

    clearTimeout(timer);

    result.model = lastModel;
    result.lastTimestamp = lastTimestamp;
    result.agentType = lastAgentType;

    // Walk lines in reverse to find last assistant message with non-zero usage
    for (let i = lines.length - 1; i >= 0; i--) {
      const obj = lines[i];
      const role = obj.role || obj.type;
      const usage = obj.usage || obj.message?.usage;

      if (role === 'assistant' && usage) {
        const inp = usage.input_tokens || 0;
        const out = usage.output_tokens || 0;
        if (inp > 1 || out > 1) {
          // Non-placeholder values found
          result.tokensIn = inp;
          result.tokensOut = out;
          result.accuracy = 'high';
          // Also update model/timestamp if present in this message
          if (obj.model) result.model = obj.model;
          if (obj.timestamp || obj.ts) result.lastTimestamp = obj.timestamp || obj.ts;
          return result;
        }
      }
    }

    // Fallback: text-length / 4 estimate
    if (totalTextLength > 0) {
      // Rough heuristic: ~75% input, ~25% output of total estimated tokens
      const estimated = Math.ceil(totalTextLength / 4);
      result.tokensIn = Math.ceil(estimated * 0.75);
      result.tokensOut = Math.ceil(estimated * 0.25);
      result.accuracy = 'approx';
    }

    return result;
  } catch (err) {
    clearTimeout(timer);
    process.stderr.write(`[jsonl-token-parser] warn: ${err.message}\n`);
    return result;
  }
}

module.exports = { parseTranscript };
