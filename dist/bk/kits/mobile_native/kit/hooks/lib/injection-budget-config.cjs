/**
 * injection-budget-config.cjs — the numbers behind the hook injection budget.
 *
 * Split out of injection-budget.cjs (CLAUDE.md §Modularization): this file owns defaults and
 * how they are overridden, nothing else. Resolution order, cheapest last:
 *
 *   per-call opts  →  env vars  →  config/hook-injection.json  →  compiled-in DEFAULTS
 *
 * The defaults are deliberately usable on their own: the kit must behave identically whether
 * or not `config/hook-injection.json` was installed.
 */

'use strict';

const fs = require('fs');
const path = require('path');

/** Shipped defaults. See config/hook-injection.json for the documented copy. */
const DEFAULTS = {
  enabled: true,
  /** Cap on any single injected block. */
  perBlockMaxBytes: 1536,
  /** Cap on everything every hook injects within one turn. */
  perTurnMaxBytes: 4096,
  /** Identical content stays quiet for this many turns. */
  dedupeTurns: 10,
  /** No hook event carries a turn id, so a turn is approximated by this time slice. */
  turnWindowMs: 60000,
  /** State older than this is a different session's leftovers — start fresh. */
  stateTtlMs: 1800000,
  /** Cap on remembered content hashes, so the state file cannot grow without bound. */
  maxEntries: 64
};

/** Appended when a block is trimmed, so the model knows text was cut. */
const DEFAULT_POINTER = '[...trimmed by hook injection budget]';

/** Numeric fields a config file or env var may override. */
const NUMERIC_KEYS = [
  'perBlockMaxBytes', 'perTurnMaxBytes', 'dedupeTurns', 'turnWindowMs', 'stateTtlMs', 'maxEntries'
];

let cachedConfig = null;

/**
 * Non-negative finite number, or undefined.
 * Shared with the state and text modules — one definition of "is this a usable number".
 * @param {*} value
 * @returns {number|undefined}
 */
function num(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/**
 * Where a shipped `hook-injection.json` might live.
 * `__dirname` is `<kit>/hooks/lib`, so `../../config` is the kit's config dir.
 * @returns {string[]}
 */
function configCandidates() {
  const out = [];
  if (process.env.BK_INJECTION_CONFIG) out.push(process.env.BK_INJECTION_CONFIG);
  out.push(path.join(__dirname, 'hook-injection.json'));
  out.push(path.join(__dirname, '..', '..', 'config', 'hook-injection.json'));
  out.push(path.join(__dirname, '..', '..', '..', 'config', 'hook-injection.json'));
  return out;
}

/** Fold the first readable config file into `cfg`. Unreadable files are skipped silently. */
function applyConfigFile(cfg) {
  for (const candidate of configCandidates()) {
    try {
      if (!candidate || !fs.existsSync(candidate)) continue;
      const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      if (parsed && typeof parsed === 'object') {
        if (typeof parsed.enabled === 'boolean') cfg.enabled = parsed.enabled;
        for (const key of NUMERIC_KEYS) {
          const v = num(parsed[key]);
          if (v !== undefined) cfg[key] = v;
        }
      }
      return;
    } catch { /* unreadable config → keep defaults */ }
  }
}

/** Fold env overrides into `cfg`. These are the escape hatch for a noisy or silent session. */
function applyEnvOverrides(cfg) {
  if (process.env.BK_INJECTION_BUDGET_DISABLED === '1') cfg.enabled = false;
  const pairs = [
    ['BK_INJECTION_MAX_BLOCK_BYTES', 'perBlockMaxBytes'],
    ['BK_INJECTION_MAX_TURN_BYTES', 'perTurnMaxBytes'],
    ['BK_INJECTION_DEDUPE_TURNS', 'dedupeTurns'],
    ['BK_INJECTION_TURN_WINDOW_MS', 'turnWindowMs']
  ];
  for (const [envName, key] of pairs) {
    const v = num(process.env[envName]);
    if (v !== undefined) cfg[key] = v;
  }
}

/**
 * Effective budget settings.
 * Cached per process; a hook process handles exactly one event, so the cache never goes stale.
 * @param {object} [overrides] — per-call overrides, applied last
 * @returns {typeof DEFAULTS}
 */
function loadInjectionConfig(overrides) {
  if (!cachedConfig) {
    const cfg = { ...DEFAULTS };
    applyConfigFile(cfg);
    applyEnvOverrides(cfg);
    cachedConfig = cfg;
  }
  return overrides ? { ...cachedConfig, ...overrides } : cachedConfig;
}

/** Test seam — drops the per-process config cache so env changes take effect. */
function resetConfigCache() {
  cachedConfig = null;
}

module.exports = {
  DEFAULTS,
  DEFAULT_POINTER,
  num,
  loadInjectionConfig,
  resetConfigCache
};
