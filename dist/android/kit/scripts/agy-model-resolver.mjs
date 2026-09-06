/**
 * agy-model-resolver.mjs — Shared model selection for every Antigravity CLI ("agy") caller.
 *
 * Extracted from bk-gemini-review so the design engine cannot drift from the reviewer: two
 * copies of a model list means one of them is wrong the day Google retires an id, and the
 * copy that is wrong is always the one nobody is looking at.
 */

// Model ids come from `agy models`, not the retired Gemini CLI.
export const DEFAULT_MODEL = 'gemini-3.1-pro-high';
export const FAST_MODEL = 'gemini-3.8-flash-high';

// Models served only by the retired Gemini CLI. Passing one is a leftover config, not a
// choice — say so rather than letting it fail at the API.
export const RETIRED_MODELS = new Set([
  'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'
]);

// `agy models` offers Claude models. Selecting one for a cross-model review silently
// restores the confirmation bias the reviewer exists to remove.
export const SELF_REVIEW_MODELS = /^claude[-.]/i;

/**
 * Resolve which model an agy invocation should use.
 *
 * @param {object} opts
 * @param {string} [opts.requested]      explicit --model value
 * @param {boolean} [opts.fast]          --fast: trade depth for latency
 * @param {object} [opts.env]            environment (injectable for tests)
 * @param {boolean} [opts.rejectClaude]  refuse Claude models (cross-model review only)
 * @returns {{model: string, warnings: string[], error: string|null}}
 */
export function resolveModel({ requested, fast = false, env = process.env, rejectClaude = false } = {}) {
  const warnings = [];
  const selected = requested
    || env.AGY_MODEL
    || env.GEMINI_MODEL          // pre-migration name, still honoured
    || (fast ? FAST_MODEL : DEFAULT_MODEL);

  if (rejectClaude && SELF_REVIEW_MODELS.test(selected)) {
    return {
      model: selected,
      warnings,
      error: `"${selected}" is a Claude model. This runner exists to have a DIFFERENT model `
        + 'check what Claude produced; pointing it at Claude restores the bias it removes.'
    };
  }

  if (RETIRED_MODELS.has(selected)) {
    warnings.push(
      `Model "${selected}" belongs to the retired Gemini CLI and is not an Antigravity model id. `
      + 'Run "agy models" to list what is available.'
    );
    // Fall back to the tier the caller asked for: --fast must not silently upgrade to the
    // heavy default just because the requested id was retired.
    return { model: fast ? FAST_MODEL : DEFAULT_MODEL, warnings, error: null };
  }

  return { model: selected, warnings, error: null };
}
