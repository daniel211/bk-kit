/**
 * inferential-judge.cjs — LLM-as-judge backend for inferential-review.
 *
 * Exports:
 *   reviewBatch(batchEntries, modelConfig) → Promise<ReviewResult>
 *
 * ReviewResult: { overall_score: number (0-1), issues: Issue[] }
 * Issue:        { severity: 'error'|'warning'|'info', file: string, message: string }
 *
 * Modes:
 *   Real mode:  Calls Claude API via ANTHROPIC_API_KEY.
 *   Mock mode:  BK_INFERENTIAL_MODE=mock → return BK_INFERENTIAL_MOCK_RESULT (JSON) or default.
 *
 * Fail-open contract:
 *   Any error (no API key, network error, timeout, invalid JSON) →
 *   return { overall_score: 1.0, issues: [] } and log warning to stderr.
 */

'use strict';

const https = require('https');

const MODULE = '[inferential-judge]';

/** Default "no issues" result — used as fail-open sentinel. */
const DEFAULT_RESULT = { overall_score: 1.0, issues: [] };

/**
 * Check whether mock mode is active.
 * @returns {boolean}
 */
function isMockMode() {
  return process.env.BK_INFERENTIAL_MODE === 'mock';
}

/**
 * Return mock result from BK_INFERENTIAL_MOCK_RESULT env var, or DEFAULT_RESULT.
 * @returns {object}
 */
function getMockResult() {
  const raw = process.env.BK_INFERENTIAL_MOCK_RESULT;
  if (!raw) return { ...DEFAULT_RESULT };
  try {
    const parsed = JSON.parse(raw);
    // Validate minimal shape
    if (typeof parsed.overall_score === 'number' && Array.isArray(parsed.issues)) {
      return parsed;
    }
    process.stderr.write(`${MODULE} getMockResult: invalid shape in BK_INFERENTIAL_MOCK_RESULT, using default\n`);
    return { ...DEFAULT_RESULT };
  } catch {
    process.stderr.write(`${MODULE} getMockResult: JSON parse failed in BK_INFERENTIAL_MOCK_RESULT, using default\n`);
    return { ...DEFAULT_RESULT };
  }
}

/**
 * Build structured prompt for Claude asking it to review a batch of edited files.
 * @param {object[]} batchEntries
 * @returns {string}
 */
function buildPrompt(batchEntries) {
  const files = batchEntries.map(e => {
    const filePath = e.file_path || e.filePath || '(unknown file)';
    const content = e.content || e.new_string || e.diff || '';
    const preview = content.length > 2000 ? content.slice(0, 2000) + '\n...(truncated)' : content;
    return `### File: ${filePath}\n\`\`\`\n${preview}\n\`\`\``;
  }).join('\n\n');

  return `You are a code quality reviewer. Review the following file edits and identify issues.

Respond ONLY with valid JSON in this exact format (no markdown, no preamble):
{
  "overall_score": <number 0.0-1.0, where 1.0 = perfect, 0.0 = severe issues>,
  "issues": [
    { "severity": "error"|"warning"|"info", "file": "<filename>", "message": "<concise description>" }
  ]
}

Focus on: code correctness, obvious bugs, security issues, architectural violations, and maintainability problems.
Do NOT flag style issues or minor formatting. Keep issues array empty if code looks good.

${files}`;
}

/**
 * Make HTTPS POST request to Anthropic Messages API.
 * @param {string} apiKey
 * @param {string} model
 * @param {string} prompt
 * @param {number} timeoutMs
 * @returns {Promise<string>} raw response text
 */
function callAnthropicAPI(apiKey, model, prompt, timeoutMs) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }]
    });

    const options = {
      hostname: 'api.anthropic.com',
      port: 443,
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      }
    };

    const timer = setTimeout(() => {
      req.destroy(new Error('Anthropic API request timed out'));
    }, timeoutMs);

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        clearTimeout(timer);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          // Surface HTTP status so retry logic can distinguish transient (429/529) from fatal
          const err = new Error(`Anthropic API error: HTTP ${res.statusCode}: ${data.slice(0, 200)}`);
          err.statusCode = res.statusCode;
          reject(err);
        }
      });
    });

    req.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });

    req.write(body);
    req.end();
  });
}

/**
 * Parse Anthropic API response to extract the JSON review result.
 * @param {string} rawResponse
 * @returns {object} ReviewResult
 */
function parseAPIResponse(rawResponse) {
  const parsed = JSON.parse(rawResponse);
  // Anthropic Messages API: response.content[0].text
  const text = parsed.content && parsed.content[0] && parsed.content[0].text;
  if (!text) throw new Error('No text content in Anthropic API response');

  // Extract JSON from the response (might have markdown fences)
  let jsonStr = text.trim();
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) jsonStr = fenceMatch[1].trim();

  const result = JSON.parse(jsonStr);
  if (typeof result.overall_score !== 'number' || !Array.isArray(result.issues)) {
    throw new Error('Invalid review result shape from LLM');
  }
  // Clamp score to [0, 1]
  result.overall_score = Math.max(0, Math.min(1, result.overall_score));
  return result;
}

/**
 * Review a batch of file edits using LLM-as-judge.
 *
 * @param {object[]} batchEntries  — queue entries from inferential-queue
 * @param {object}   modelConfig   — { model, timeout_ms } (from policy.inferential_review)
 * @returns {Promise<{ overall_score: number, issues: object[] }>}
 */
async function reviewBatch(batchEntries, modelConfig = {}) {
  // Mock mode — deterministic result for tests
  if (isMockMode()) {
    return getMockResult();
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    process.stderr.write(`${MODULE} No ANTHROPIC_API_KEY — fail-open with perfect score\n`);
    return { ...DEFAULT_RESULT };
  }

  if (!batchEntries || batchEntries.length === 0) {
    return { ...DEFAULT_RESULT };
  }

  const model = modelConfig.model || 'claude-haiku-4-5';
  const timeoutMs = modelConfig.timeout_ms || 60000;

  try {
    const prompt = buildPrompt(batchEntries);
    let raw;
    try {
      raw = await callAnthropicAPI(apiKey, model, prompt, timeoutMs);
    } catch (e) {
      // P1-3: retry once on transient overload (429 rate limit, 529 overloaded)
      if (e.statusCode === 429 || e.statusCode === 529) {
        process.stderr.write(`${MODULE} transient ${e.statusCode} — retrying after 2s backoff\n`);
        await new Promise(r => setTimeout(r, 2000));
        raw = await callAnthropicAPI(apiKey, model, prompt, timeoutMs);
      } else {
        throw e;
      }
    }
    const result = parseAPIResponse(raw);
    return result;
  } catch (e) {
    process.stderr.write(`${MODULE} reviewBatch error (fail-open): ${e.message}\n`);
    return { ...DEFAULT_RESULT };
  }
}

module.exports = { reviewBatch, buildPrompt, DEFAULT_RESULT };
