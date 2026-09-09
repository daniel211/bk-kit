/**
 * harness-policy-loader.cjs — Load and validate .bk-harness-policy.json
 *
 * Resolution order:
 *   1. $BK_HARNESS_POLICY_PATH (env override, absolute path)
 *   2. <projectRoot>/.claude/bk-harness-policy.json (user customization)
 *   3. <projectRoot>/.claude/hooks/lib/bk-harness-policy.json (shipped — installed kit)
 *   4. <projectRoot>/src/hooks/_base/lib/bk-harness-policy.json (dev-mode, this repo)
 *   5. Hardcoded DEFAULT_POLICY (last-resort fallback)
 *
 * Also provides:
 *   - getMetricsDir() — returns <projectRoot>/.bk-metrics (auto-create)
 *   - resolveMetricPath(relPath) — absolute path under .bk-metrics
 *   - trackRedSignal(type, meta) — append to red-signals.jsonl
 *   - trackViolation(entry) — append to violations.jsonl
 *
 * Fail-open: if policy file corrupt, return DEFAULT_POLICY + log warning.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { resolveProjectRoot } = require('./resolve-project-root.cjs');

const DEFAULT_POLICY = {
  version: '1.0.0',
  deadloop: {
    tool_repetition: {
      enabled: true, warn_threshold: 3, block_threshold: 5, window_size: 10,
      ring_file: '.bk-metrics/tool-call-ring.json',
      exempt_tools: ['Read', 'Glob', 'TodoWrite']
    },
    no_progress: {
      enabled: true, oscillation_window: 6, oscillation_block_threshold: 4,
      trivial_edit_max_chars: 20, trivial_edit_block_threshold: 5,
      file_edit_history: '.bk-metrics/file-edit-history.jsonl'
    },
    phase_recurrence: {
      enabled: true, warn_count: 2, block_count: 3, halt_count: 4,
      bypass_env: 'BK_HARNESS_RECURRENCE_OVERRIDE'
    },
    subagent_iteration: {
      enabled: true, default_cap: 3, per_agent_caps: {},
      bypass_env: 'BK_HARNESS_DISPATCH_OVERRIDE'
    }
  },
  kill_switch: {
    enabled: true, min_red_signals: 2, lookback_minutes: 30,
    red_signal_types: [
      'tool_repetition_blocked', 'oscillation_blocked',
      'phase_recurrence_blocked', 'subagent_cap_exceeded',
      'budget_exceeded', 'fsm_invalid_transition_repeated',
      'ui_snapshot_gap', 'test_gap_persistent',
      'native_lint_ios', 'native_lint_android', 'native_lint_flutter'
    ],
    bypass_env: 'BK_HARNESS_OVERRIDE',
    red_signals_file: '.bk-metrics/red-signals.jsonl'
  },
  arch_fitness: {
    ios: { enabled: false, rules: {}, presentation_paths: [], domain_paths: [], exclude_paths: [] },
    android: { enabled: false, rules: {}, presentation_paths: [], domain_paths: [], exclude_paths: [] },
    flutter: { enabled: false, rules: {}, domain_paths: [], exclude_paths: [] }
  },
  steerer: {
    enabled: true, min_violation_count: 3, lookback_days: 30,
    draft_path: 'bk/dev/shared/.learned-preferences-draft.md',
    target_path: 'bk/dev/shared/learned-preferences.md',
    backup_dir: '.bk-metrics/learned-preferences-backups'
  },
  monitor: {
    violations_file: '.bk-metrics/violations.jsonl',
    decisions_file: '.bk-metrics/decisions.jsonl',
    rotate_max_lines: 5000,
    statusline_cache: '.bk-metrics/statusline-cache.json',
    statusline_cache_ttl_ms: 5000,
    ashby: { enabled: true, silent_days_warn: 7, warnings_file: '.bk-metrics/ashby-warnings.jsonl' }
  },
  token_monitoring: {
    enabled: true,
    burn_rate_threshold_per_min: 50000,
    consecutive_windows: 3,
    window_minutes: 1,
    lookback_window_minutes: 5,
    burn_window_file: '.bk-metrics/token-burn-window.jsonl',
    statusline_show_tokens: true,
    statusline_show_cost: true,
    statusline_show_rate: true,
    statusline_show_usage_totals: true,
    usage_rollup_refresh_ms: 300000,
    usage_month_budget_usd: null,
    usage_week_budget_usd: null
  },
  inferential_review: {
    enabled: true,
    batch_size: 5,
    tier1_min_diff_chars: 20,
    tier1_max_file_size_bytes: 500000,
    file_patterns: ['*.swift', '*.kt', '*.java', '*.dart', '*.ts', '*.tsx', '*.js'],
    exempt_path_patterns: ['tests/', 'node_modules/', '.generated.', 'build/'],
    quality_score_threshold: 0.7,
    timeout_ms: 60000,
    queue_file: '.bk-metrics/inferential-queue.jsonl',
    results_file: '.bk-metrics/inferential-results.jsonl',
    model: 'claude-haiku-4-5',
    bypass_env: 'BK_INFERENTIAL_SKIP'
  },
  test_generation: {
    enabled: true,
    mode: 'suggest',
    languages: ['swift', 'kotlin', 'dart', 'typescript', 'javascript'],
    exclude_patterns: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/*.generated.*']
  },
  ui_snapshot: {
    enabled: true,
    require_golden: false,
    platforms: ['ios', 'android', 'flutter']
  },
  mutation_testing: {
    enabled: true,
    scan_on_manifest_change: true
  },
  pbt_suggester: {
    enabled: true,
    min_cases: 10,
    sample_threshold: 0.7
  },
  native_lint: {
    enabled: true,
    cache_ttl_seconds: 300,
    timeout_ms: 30000,
    ios: {
      enabled: true,
      tool: 'swiftlint',
      block_on_error: false,
      config_path: '.swiftlint.yml'
    },
    android: {
      enabled: true,
      preferred_tool: 'detekt',
      allow_gradle_lint: false,
      block_on_error: false,
      detekt_config: 'detekt.yml'
    },
    flutter: {
      enabled: true,
      tool: 'dart_analyze',
      block_on_error: false,
      analysis_options: 'analysis_options.yaml'
    },
    fallback_to_regex: true
  },
  cost_budget: {
    enabled: true,
    pr_budget_usd: 5.0,
    session_budget_usd: 20.0,
    enforcement: 'warn',
    ledger_path: '.bk-metrics/cost-ledger.jsonl'
  },
  subagent_observability: {
    enabled: true,
    live_tracker: {
      jsonl_path: '.bk-metrics/subagent-live.jsonl',
      max_entries: 10000
    },
    accurate_parser: {
      timeout_ms: 800,
      fallback_char_per_token: 4
    },
    statusline: {
      max_display: 3,
      show_cost: true,
      show_tokens: true
    },
    parallel_metric: {
      overlap_threshold_ms: 1000
    }
  },
  // Documentation-only block — lists supported env override flags.
  // Present in DEFAULT_POLICY so `policy.policy_overrides` is never undefined
  // in fallback mode (prevents ReferenceError in any future reader).
  policy_overrides: {
    BK_HARNESS_POLICY_PATH: 'Override path to policy file (absolute)',
    BK_HARNESS_OVERRIDE: 'Bypass global kill-switch (one-time)',
    BK_HARNESS_DISPATCH_OVERRIDE: 'Format: agent=N,agent=N (raise per-agent cap)',
    BK_HARNESS_RECURRENCE_OVERRIDE: 'Bypass phase recurrence block (one-time)',
    BK_ARCH_FITNESS_SKIP: 'Comma-separated rule IDs to skip',
    BK_INFERENTIAL_SKIP: "Set to 1 to bypass inferential review entirely",
    BK_INFERENTIAL_MODE: "Set to 'mock' to use deterministic mock results",
    BK_INFERENTIAL_MOCK_RESULT: 'JSON-encoded mock result for BK_INFERENTIAL_MODE=mock'
  }
};

let _cached = null;
let _cachedPath = null;

function deepMerge(target, source) {
  if (!source || typeof source !== 'object') return target;
  if (!target || typeof target !== 'object') return source;
  const result = Array.isArray(target) ? [...target] : { ...target };
  for (const key of Object.keys(source)) {
    const sv = source[key];
    const tv = target[key];
    if (sv !== null && typeof sv === 'object' && !Array.isArray(sv)) {
      result[key] = deepMerge(tv || {}, sv);
    } else {
      result[key] = sv;
    }
  }
  return result;
}

function resolvePolicyPath(projectRoot) {
  const envPath = process.env.BK_HARNESS_POLICY_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;

  const userPath = path.join(projectRoot, '.claude', 'bk-harness-policy.json');
  if (fs.existsSync(userPath)) return userPath;

  // Installed-kit case: hooks live at <root>/.claude/hooks/lib/
  const installedPath = path.join(projectRoot, '.claude', 'hooks', 'lib', 'bk-harness-policy.json');
  if (fs.existsSync(installedPath)) return installedPath;

  // Dev-mode case (this repo): source in src/hooks/_base/lib/
  const devPath = path.join(projectRoot, 'src', 'hooks', '_base', 'lib', 'bk-harness-policy.json');
  if (fs.existsSync(devPath)) return devPath;

  // Also try co-located (when loader is run directly via __dirname)
  try {
    const coLocated = path.join(__dirname, 'bk-harness-policy.json');
    if (fs.existsSync(coLocated)) return coLocated;
  } catch { /* ignore */ }

  return null;
}

/**
 * Load harness policy merged with defaults. Cached per-process.
 * @param {{ force?: boolean, projectRoot?: string }} [opts]
 * @returns {object}
 */
function loadHarnessPolicy(opts = {}) {
  if (_cached && !opts.force) return _cached;

  const root = opts.projectRoot || resolveProjectRoot();
  const policyPath = resolvePolicyPath(root);

  let userPolicy = {};
  if (policyPath) {
    try {
      userPolicy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
      _cachedPath = policyPath;
    } catch (e) {
      process.stderr.write(`[harness-policy-loader] Failed to parse ${policyPath}: ${e.message}\n`);
    }
  }

  _cached = deepMerge(DEFAULT_POLICY, userPolicy);
  _cached.__resolvedPath = _cachedPath;
  _cached.__projectRoot = root;
  return _cached;
}

/**
 * Get absolute path to .bk-metrics dir (auto-create on first call).
 */
function getMetricsDir(projectRoot) {
  const root = projectRoot || resolveProjectRoot();
  const dir = path.join(root, '.bk-metrics');
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch { /* fail-open */ }
  return dir;
}

/**
 * Resolve a relative metric path against .bk-metrics dir (or absolute passthrough).
 */
function resolveMetricPath(relPath, projectRoot) {
  if (!relPath) return null;
  if (path.isAbsolute(relPath)) return relPath;
  const root = projectRoot || resolveProjectRoot();
  // Paths in policy often start with ".bk-metrics/..." already
  if (relPath.startsWith('.bk-metrics')) return path.join(root, relPath);
  return path.join(getMetricsDir(root), relPath);
}

/**
 * Append a JSONL entry to a file. Auto-rotate via jsonl-rotator (size-based).
 *
 * RC-3: delegates to jsonl-rotator.appendJsonl for consistent rotation behavior
 * across the harness. Previous probabilistic line-based rotation removed —
 * jsonl-rotator does deterministic size-based rotation (10MB default, archives kept).
 *
 * @param {string} filePath
 * @param {object} entry — JSON-serializable entry
 * @param {number} [rotateMaxLines] — legacy param, ignored (size-based rotation now)
 */
function appendJsonl(filePath, entry, _rotateMaxLines) {
  try {
    const { appendJsonl: rotateAppend } = require('./jsonl-rotator.cjs');
    rotateAppend(filePath, JSON.stringify(entry) + '\n');
  } catch {
    // Fail-open fallback: direct append without rotation
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf8');
    } catch { /* fail-open */ }
  }
}

/**
 * Track a red signal — shared helper for all deadloop detectors + kill-switch.
 * @param {string} type - one of policy.kill_switch.red_signal_types
 * @param {object} meta - arbitrary context (tool, agent, etc.)
 */
function trackRedSignal(type, meta = {}) {
  try {
    const policy = loadHarnessPolicy();
    const root = policy.__projectRoot;
    const file = resolveMetricPath(policy.kill_switch.red_signals_file, root);
    const entry = { ts: Date.now(), type, ...meta };
    appendJsonl(file, entry, policy.monitor.rotate_max_lines);
  } catch { /* fail-open */ }
}

/**
 * Track a violation — unified violation log (input for dashboard + steerer).
 * @param {object} entry - { hook, violation_type, tool, target, agent, blocked, severity, context }
 */
function trackViolation(entry) {
  try {
    const policy = loadHarnessPolicy();
    const root = policy.__projectRoot;
    const file = resolveMetricPath(policy.monitor.violations_file, root);
    const record = { ts: Date.now(), ...entry };
    appendJsonl(file, record, policy.monitor.rotate_max_lines);
  } catch { /* fail-open */ }
}

/**
 * Track a decision — used by decision-tracker hook.
 */
function trackDecision(entry) {
  try {
    const policy = loadHarnessPolicy();
    const root = policy.__projectRoot;
    const file = resolveMetricPath(policy.monitor.decisions_file, root);
    const record = { ts: Date.now(), ...entry };
    appendJsonl(file, record, policy.monitor.rotate_max_lines);
  } catch { /* fail-open */ }
}

/**
 * Read recent red-signals entries within lookback window.
 */
function readRecentRedSignals(lookbackMinutes) {
  try {
    const policy = loadHarnessPolicy();
    const root = policy.__projectRoot;
    const file = resolveMetricPath(policy.kill_switch.red_signals_file, root);
    if (!fs.existsSync(file)) return [];
    const cutoff = Date.now() - (lookbackMinutes * 60 * 1000);
    const raw = fs.readFileSync(file, 'utf8');
    return raw.split('\n').filter(Boolean).map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(e => e && e.ts >= cutoff);
  } catch {
    return [];
  }
}

/**
 * Reset cache (for tests).
 */
function _resetCache() {
  _cached = null;
  _cachedPath = null;
}

module.exports = {
  loadHarnessPolicy,
  getMetricsDir,
  resolveMetricPath,
  appendJsonl,
  trackRedSignal,
  trackViolation,
  trackDecision,
  readRecentRedSignals,
  DEFAULT_POLICY,
  _resetCache
};
