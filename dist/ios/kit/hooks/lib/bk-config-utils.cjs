/**
 * bk-config-utils.cjs - Shared config utilities for beer-kit hooks
 *
 * Adds: readPlatformContext(), readWorkflowState(), writeWorkflowState(), getOutputPath()
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// Version constant for rules/hooks compatibility checking (CR-P0-14)
const BK_VERSION = '2.1.0';

const { resolveProjectRoot } = require('./resolve-project-root.cjs');

const GLOBAL_CONFIG_PATH = path.join(os.homedir(), '.claude', '.bk.json');

const DEFAULT_CONFIG = {
  plan: {
    namingFormat: '{date}-{slug}',
    dateFormat: 'YYMMDD-HHmm',
    reportsDir: 'reports'
  },
  paths: {
    docs: 'docs',
    plans: 'mk/dev'
  },
  locale: {
    thinkingLanguage: null,
    responseLanguage: null
  },
  hooks: {
    'session-init': true,
    'privacy-block': true,
    'scout-block': true,
    'security-check': true,
    'delegation-enforcer': true,
    'verify-output': true,
    'context-safety': true,
    'post-commit': true,
    'anti-self-implementation': true,
    'subagent-init': true,
    'checkpoint-save': true,
    'fsm-guard': true,
    'task-completed-handler': true,
    'teammate-idle-handler': true,
    'team-context-inject': true,
    'agent-signal-detector': true,
    'agent-memory-path-guard': true,
    'mcp-health-monitor': true,
    'workflow-metrics': true,
    'pattern-extractor': true,
    'skill-chain-suggest': true,
    'traceability-check': true,
    'project-profile': true,
    'preference-tracker': true,
    'completion-notify': true,
    'dynamic-effort': true,
    'subagent-cost-capture': true,
    'session-cost-rollup': true,
    'budget-guard': true,
    'context-monitor': true,
    'handoff-writer': true,
    'tool-repetition-detector': true,
    'no-progress-detector': true,
    'subagent-iteration-cap': true,
    'global-kill-switch': true,
    'decision-tracker': true,
    'arch-fitness-ios': true,
    'arch-fitness-android': true,
    'arch-fitness-flutter': true,
    'arch-fitness-ios-native': true,
    'arch-fitness-android-native': true,
    'arch-fitness-flutter-native': true,
    'token-burn-detector': true,
    'inferential-review': true,
    'test-generation-hook': true,
    'ui-snapshot-compare': true,
    'mutation-testing-sensor': true,
    'property-based-test-suggester': true,
    'subagent-live-tracker': true
  },
  platform: 'auto'
};

/** Deep merge two objects (source wins, arrays replaced) */
function deepMerge(target, source) {
  if (!source || typeof source !== 'object') return target;
  if (!target || typeof target !== 'object') return source;
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const sv = source[key];
    const tv = target[key];
    if (Array.isArray(sv)) {
      result[key] = [...sv];
    } else if (sv !== null && typeof sv === 'object' && Object.keys(sv).length > 0) {
      result[key] = deepMerge(tv || {}, sv);
    } else {
      result[key] = sv;
    }
  }
  return result;
}

/** Load config from a file path, returns null on miss/error */
function loadConfigFromPath(configPath) {
  try {
    if (!fs.existsSync(configPath)) return null;
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Load config: DEFAULT -> global -> local (local wins)
 * @returns {Object} Merged config
 */
function loadConfig() {
  const globalCfg = loadConfigFromPath(GLOBAL_CONFIG_PATH);
  const localConfigPath = path.join(resolveProjectRoot(), '.claude', '.bk.json');
  const localCfg = loadConfigFromPath(localConfigPath);
  if (!globalCfg && !localCfg) return { ...DEFAULT_CONFIG };

  let merged = deepMerge({}, DEFAULT_CONFIG);
  if (globalCfg) merged = deepMerge(merged, globalCfg);
  if (localCfg) merged = deepMerge(merged, localCfg);
  return merged;
}

/**
 * Check if a named hook is enabled in config.
 * Returns true if not explicitly set to false.
 * @param {string} hookName
 * @returns {boolean}
 */
/**
 * Check if a named hook is enabled in config.
 * Accepts optional pre-loaded config to avoid redundant file reads.
 * @param {string} hookName
 * @param {Object} [config] - Pre-loaded config (optional, avoids double-load)
 * @returns {boolean}
 */
function isHookEnabled(hookName, config) {
  const cfg = config || loadConfig();
  const hooks = cfg.hooks || {};
  return hooks[hookName] !== false && hooks[hookName] !== null;
}

/**
 * Read platform-context.json from project root or mk/dev/shared/
 * Returns context object or null.
 * @returns {Object|null}
 */
function readPlatformContext() {
  const root = resolveProjectRoot();
  const candidates = [
    path.join(root, '.claude', 'platform-context.json'),
    path.join(root, 'mk', 'dev', 'shared', 'platform-context.json')
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
      }
    } catch { /* skip */ }
  }
  return null;
}

/**
 * Read .workflow-state.json from mk/dev/shared/
 * Fallback chain: primary file → .bak backup → latest checkpoint
 * @returns {Object|null}
 */
function readWorkflowState() {
  const root = resolveProjectRoot();
  const statePath = path.join(root, 'mk', 'dev', 'shared', '.workflow-state.json');
  const bakPath = statePath + '.bak';

  // Try primary file
  try {
    if (fs.existsSync(statePath)) {
      return JSON.parse(fs.readFileSync(statePath, 'utf8'));
    }
  } catch {
    // Primary corrupted — try backup
    try {
      const backup = JSON.parse(fs.readFileSync(bakPath, 'utf8'));
      try {
        const logger = require('./hook-logger.cjs');
        logger.log('warn', 'bk-config', 'workflow-state corrupted, recovered from .bak');
      } catch { /* logger unavailable */ }
      return backup;
    } catch { /* no backup */ }

    // Try latest checkpoint
    const checkpoint = readLatestCheckpoint();
    if (checkpoint) {
      try {
        const logger = require('./hook-logger.cjs');
        logger.log('warn', 'bk-config', 'workflow-state and .bak failed, recovered from checkpoint');
      } catch { /* logger unavailable */ }
      return checkpoint;
    }
  }

  return null;
}

/**
 * Write (merge-update) .workflow-state.json atomically
 * @param {Object} updates - Fields to merge into state
 * @returns {boolean}
 */
function writeWorkflowState(updates) {
  const root = resolveProjectRoot();
  const statePath = path.join(root, 'mk', 'dev', 'shared', '.workflow-state.json');
  const bakPath = statePath + '.bak';
  const lockPath = statePath + '.lock';
  const tmpPath = statePath + '.' + Math.random().toString(36).slice(2);
  try {
    // Simple lockfile — fail fast if another writer holds it
    try {
      fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
    } catch {
      // Lock exists — check if stale (>5s) and force-acquire
      try {
        const stat = fs.statSync(lockPath);
        if (Date.now() - stat.mtimeMs > 15000) {
          fs.unlinkSync(lockPath);
          fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
        } else {
          return false; // Another writer is active, skip
        }
      } catch { return false; }
    }

    // Back up current state before overwriting
    try { fs.copyFileSync(statePath, bakPath); } catch { /* no existing file to back up */ }

    const existing = readWorkflowState() || {};
    const next = { ...existing, ...updates, updated_at: new Date().toISOString() };
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(tmpPath, JSON.stringify(next, null, 2));
    fs.renameSync(tmpPath, statePath);

    // Verify written file is valid JSON
    try {
      JSON.parse(fs.readFileSync(statePath, 'utf8'));
    } catch {
      // Written file is corrupt — restore from backup
      try {
        fs.copyFileSync(bakPath, statePath);
      } catch { /* backup also unavailable */ }
      try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
      return false;
    }

    try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
    return true;
  } catch {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
    return false;
  }
}

/**
 * Get canonical output file path for an agent report
 * @param {string} agentType - e.g. 'code-reviewer', 'unit-test-agent'
 * @param {string} feature - Feature name slug
 * @param {string} [platform] - Platform for test agents (ios/android/flutter)
 * @returns {string} Absolute path
 */
function getOutputPath(agentType, feature, platform) {
  const base = path.join(resolveProjectRoot(), 'mk', 'dev', 'shared', 'reports');
  // Normalize: strip bk- prefix for filename generation
  const bare = agentType.replace(/^bk-/, '');
  const pfx = platform || 'unknown';
  const map = {
    'code-reviewer': `code-review-${feature}.md`,
    'security-auditor': `security-${feature}.md`,
    'performance-analyzer': `performance-${feature}.md`,
    'unit-test-agent': `unit-test-${pfx}-${feature}.md`,
    'device-test-agent': `device-test-${pfx}-${feature}.md`,
    'test-architect': `test-strategy-${feature}.md`
  };
  const filename = map[bare] || `${bare}-${feature}.md`;
  return path.join(base, filename);
}

/**
 * Parse metadata from a Markdown report's <!-- metadata: {...} --> footer
 * @param {string} content - Report file content
 * @returns {Object|null}
 */
function parseReportMetadata(content) {
  const match = content.match(/<!-- metadata: ({.*?}) -->/);
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch { return null; }
}

/**
 * Save a checkpoint file, pruning to maxKeep
 * @param {Object} data - Checkpoint data
 * @param {number} [maxKeep=5] - Max checkpoints to retain
 * @returns {boolean}
 */
function saveCheckpoint(data, maxKeep = 5) {
  const dir = path.join(resolveProjectRoot(), 'mk', 'dev', 'shared', 'checkpoints');
  try {
    fs.mkdirSync(dir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `checkpoint_${ts}.json`;
    const finalPath = path.join(dir, filename);
    const tmpPath = finalPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
    fs.renameSync(tmpPath, finalPath);
    pruneCheckpoints(dir, maxKeep);
    return true;
  } catch { return false; }
}

/**
 * Read the most recent checkpoint file
 * @returns {Object|null}
 */
function readLatestCheckpoint() {
  const dir = path.join(resolveProjectRoot(), 'mk', 'dev', 'shared', 'checkpoints');
  try {
    if (!fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir)
      .filter(f => f.startsWith('checkpoint_') && f.endsWith('.json'))
      .sort();
    if (files.length === 0) return null;
    // Try latest, fallback to previous if corrupted
    for (let i = files.length - 1; i >= 0; i--) {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, files[i]), 'utf8'));
      } catch { /* try previous */ }
    }
    return null;
  } catch { return null; }
}

/**
 * Delete oldest checkpoint files beyond maxKeep
 * @param {string} dir - Checkpoints directory
 * @param {number} maxKeep - Max files to retain
 */
function pruneCheckpoints(dir, maxKeep) {
  try {
    const files = fs.readdirSync(dir)
      .filter(f => f.startsWith('checkpoint_') && f.endsWith('.json'))
      .sort();
    while (files.length > maxKeep) {
      fs.unlinkSync(path.join(dir, files.shift()));
    }
  } catch { /* fail silently */ }
}

/**
 * Format date by replacing tokens in a format string
 * @param {string} format - e.g. 'YYMMDD-HHmm'
 * @returns {string}
 */
function formatDate(format) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return format
    .replace('YYYY', now.getFullYear())
    .replace('YY', String(now.getFullYear()).slice(-2))
    .replace('MM', pad(now.getMonth() + 1))
    .replace('DD', pad(now.getDate()))
    .replace('HH', pad(now.getHours()))
    .replace('mm', pad(now.getMinutes()));
}

/**
 * Build the "## Language" prompt-context section from locale config.
 * Mirrors ClaudeKit's context-builder.cjs buildLanguageSection().
 * @param {Object} opts
 * @param {string|null} [opts.thinkingLanguage]
 * @param {string|null} [opts.responseLanguage]
 * @returns {string[]} Lines to inject (empty array if nothing configured)
 */
function buildLanguageSection({ thinkingLanguage, responseLanguage }) {
  const effectiveThinking = thinkingLanguage || (responseLanguage ? 'en' : null);
  const hasThinking = effectiveThinking && effectiveThinking !== responseLanguage;
  const hasResponse = responseLanguage;
  const lines = [];

  if (hasThinking || hasResponse) {
    lines.push(`## Language`);
    if (hasThinking) {
      lines.push(`- Thinking: Use ${effectiveThinking} for reasoning (logic, precision).`);
    }
    if (hasResponse) {
      lines.push(`- Response: Respond in ${responseLanguage} (natural, fluent).`);
    }
    lines.push(``);
  }

  return lines;
}

/**
 * Write an env var to CLAUDE_ENV_FILE (key=value format).
 * Silently skips if envFile is falsy or write fails.
 * @param {string} envFile - Path from process.env.CLAUDE_ENV_FILE
 * @param {string} key - Env var name (e.g. BK_PLATFORM)
 * @param {string} value - Env var value
 */
function writeEnv(envFile, key, value) {
  if (!envFile || !key) return;
  try {
    const safeValue = String(value || '').replace(/\n/g, '');
    fs.appendFileSync(envFile, `${key}=${safeValue}\n`);
  } catch { /* fail silently */ }
}

// --- Plan resolution, naming, and path safety utilities ---

/** Characters invalid in filenames across Windows, macOS, Linux */
const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\x00-\x1f\x7f]/g;

/**
 * Sanitize slug for safe filesystem usage.
 * Removes invalid chars, collapses hyphens, limits length.
 * @param {string} slug
 * @returns {string}
 */
function sanitizeSlug(slug) {
  if (!slug || typeof slug !== 'string') return '';
  return slug
    .replace(INVALID_FILENAME_CHARS, '')
    .replace(/[^a-z0-9-]/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

/**
 * Sanitize path — block null bytes, prevent traversal outside project root.
 * Allows absolute paths (user explicitly set).
 * @param {string} pathValue
 * @param {string} projectRoot
 * @returns {string|null}
 */
function sanitizePath(pathValue, projectRoot) {
  if (!pathValue || typeof pathValue !== 'string') return null;
  const normalized = pathValue.trim().replace(/[/\\]+$/, '');
  if (!normalized) return null;
  if (/[\x00]/.test(normalized)) return null;
  if (path.isAbsolute(normalized)) return normalized;
  const resolved = path.resolve(projectRoot, normalized);
  if (!resolved.startsWith(projectRoot + path.sep) && resolved !== projectRoot) return null;
  return normalized;
}

/**
 * Extract feature slug from git branch name.
 * Pattern: feat|fix|chore|refactor|docs / optional-scope / slug
 * @param {string} branch
 * @param {string} [pattern]
 * @returns {string|null}
 */
function extractSlugFromBranch(branch, pattern) {
  if (!branch) return null;
  const defaultPattern = /(?:feat|fix|chore|refactor|docs)\/(?:[^\/]+\/)?(.+)/;
  const regex = pattern ? new RegExp(pattern) : defaultPattern;
  const match = branch.match(regex);
  return match ? sanitizeSlug(match[1]) : null;
}

/**
 * Extract issue ID from branch name (e.g. feat/gh-123-foo → "123").
 * @param {string} branch
 * @returns {string|null}
 */
function extractIssueFromBranch(branch) {
  if (!branch) return null;
  const patterns = [
    /(?:issue|gh|fix|feat|bug)[/-]?(\d+)/i,
    /[/-](\d+)[/-]/,
    /#(\d+)/
  ];
  for (const p of patterns) {
    const match = branch.match(p);
    if (match) return match[1];
  }
  return null;
}

/**
 * Validate naming pattern — must contain {slug}, no unresolved placeholders.
 * @param {string} pattern
 * @returns {{ valid: boolean, error?: string }}
 */
function validateNamingPattern(pattern) {
  if (!pattern || typeof pattern !== 'string') {
    return { valid: false, error: 'Pattern is empty or not a string' };
  }
  const withoutSlug = pattern.replace(/\{slug\}/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!withoutSlug) return { valid: false, error: 'Pattern resolves to empty after removing {slug}' };
  const unresolvedMatch = withoutSlug.match(/\{[^}]+\}/);
  if (unresolvedMatch) return { valid: false, error: `Unresolved placeholder: ${unresolvedMatch[0]}` };
  if (!pattern.includes('{slug}')) return { valid: false, error: 'Pattern must contain {slug} placeholder' };
  return { valid: true };
}

/**
 * Resolve naming pattern with date and optional issue prefix.
 * Keeps {slug} as placeholder for agents to substitute.
 * @param {Object} planConfig - { namingFormat, dateFormat, issuePrefix }
 * @param {string|null} gitBranch
 * @returns {string}
 */
function resolveNamingPattern(planConfig, gitBranch) {
  const { namingFormat, dateFormat, issuePrefix } = planConfig;
  const formattedDate = formatDate(dateFormat);
  const issueId = extractIssueFromBranch(gitBranch);
  const fullIssue = issueId && issuePrefix ? `${issuePrefix}${issueId}` : null;

  let pattern = namingFormat;
  pattern = pattern.replace('{date}', formattedDate);
  if (fullIssue) {
    pattern = pattern.replace('{issue}', fullIssue);
  } else {
    pattern = pattern.replace(/-?\{issue\}-?/, '-').replace(/--+/g, '-');
  }
  pattern = pattern
    .replace(/^-+/, '').replace(/-+$/, '')
    .replace(/-+(\{slug\})/g, '-$1')
    .replace(/(\{slug\})-+/g, '$1-')
    .replace(/--+/g, '-');

  const validation = validateNamingPattern(pattern);
  if (!validation.valid && process.env.BK_DEBUG) {
    console.error(`[bk-config] Warning: ${validation.error}`);
  }
  return pattern;
}

/**
 * Resolve plan path by session state or branch matching.
 * @param {string} sessionId
 * @param {Object} config
 * @returns {{ path: string|null, resolvedBy: 'session'|'branch'|null }}
 */
function resolvePlanPath(sessionId, config) {
  const plansDir = config?.paths?.plans || 'mk/dev';
  const resolution = config?.plan?.resolution || {};
  const order = resolution.order || ['session', 'branch'];
  const branchPattern = resolution.branchPattern;

  for (const method of order) {
    switch (method) {
      case 'session': {
        // Read session state from workflow state (MK uses workflow state, not temp files)
        const state = readWorkflowState();
        const activePlan = state?.active_plan || process.env.BK_ACTIVE_PLAN;
        if (activePlan) {
          return { path: activePlan, resolvedBy: 'session' };
        }
        break;
      }
      case 'branch': {
        try {
          const { execSync } = require('child_process');
          const branch = execSync('git branch --show-current', {
            encoding: 'utf8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe']
          }).trim();
          const slug = extractSlugFromBranch(branch, branchPattern);
          if (slug && fs.existsSync(plansDir)) {
            const entries = fs.readdirSync(plansDir, { withFileTypes: true })
              .filter(e => e.isDirectory() && e.name.includes(slug));
            if (entries.length > 0) {
              return { path: path.join(plansDir, entries[entries.length - 1].name), resolvedBy: 'branch' };
            }
          }
        } catch { /* ignore */ }
        break;
      }
    }
  }
  return { path: null, resolvedBy: null };
}

/**
 * Extract task list ID from plan resolution for Claude Tasks coordination.
 * Only returns ID for session-resolved plans (not branch-suggested).
 * @param {{ path: string|null, resolvedBy: string|null }} resolved
 * @returns {string|null}
 */
function extractTaskListId(resolved) {
  if (!resolved || resolved.resolvedBy !== 'session' || !resolved.path) return null;
  return path.basename(resolved.path);
}

module.exports = {
  BK_VERSION,
  DEFAULT_CONFIG,
  loadConfig,
  loadConfigFromPath,
  isHookEnabled,
  readPlatformContext,
  readWorkflowState,
  writeWorkflowState,
  writeEnv,
  getOutputPath,
  parseReportMetadata,
  saveCheckpoint,
  readLatestCheckpoint,
  pruneCheckpoints,
  formatDate,
  buildLanguageSection,
  deepMerge,
  sanitizeSlug,
  sanitizePath,
  extractSlugFromBranch,
  extractIssueFromBranch,
  resolveNamingPattern,
  validateNamingPattern,
  resolvePlanPath,
  extractTaskListId
};
