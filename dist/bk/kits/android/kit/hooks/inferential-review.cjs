#!/usr/bin/env node
/**
 * inferential-review.cjs — Tiered LLM-as-judge semantic review hook.
 *
 * Trigger: PostToolUse  matcher: Edit|Write
 * Purpose: Automatically queue file edits and periodically trigger LLM
 *          quality review (Inferential Sensor) without blocking the agent.
 *
 * Three-tier strategy:
 *   Tier 1 (always):  Cheap precondition checks — file extension, diff size,
 *                     exempt path. Skip immediately if fail. Cost: ~ms.
 *   Tier 2 (queue):   Append to .bk-metrics/inferential-queue.jsonl.
 *                     When queue reaches batch_size, trigger Tier 3.
 *   Tier 3 (judge):   Detached background Node process invokes inferential-judge
 *                     and writes result to .bk-metrics/inferential-results.jsonl.
 *                     Hook exits 0 immediately — does NOT wait for result.
 *
 * Exit codes:
 *   0 — always (fail-open: never block agent for inferential issues)
 *
 * Env vars:
 *   BK_INFERENTIAL_SKIP=1    — bypass entirely
 *   BK_PROJECT_ROOT          — override project root (test isolation)
 *   BK_HARNESS_POLICY_PATH   — override policy file path
 *   ANTHROPIC_API_KEY        — required for a real review; absent (outside mock mode) the hook
 *                              skips at Tier 1 rather than queueing work no judge will do
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const libDir = path.join(__dirname, 'lib');
const {
  loadHarnessPolicy,
  trackRedSignal,
  trackViolation,
  resolveMetricPath
} = require(path.join(libDir, 'harness-policy-loader.cjs'));
const { enqueueEdit, getQueueSize, clearQueue } = require(path.join(libDir, 'inferential-queue.cjs'));
const { isJudgeAvailable } = require(path.join(libDir, 'inferential-judge.cjs'));
const { createHookTimer } = require(path.join(libDir, 'hook-logger.cjs'));

const HOOK_NAME = 'inferential-review';

// ─── Tier 1 helpers ────────────────────────────────────────────────────────

/**
 * Match a filename against a glob-like pattern (supports *.ext).
 * @param {string} filename
 * @param {string} pattern  — e.g. "*.swift"
 * @returns {boolean}
 */
function matchesPattern(filename, pattern) {
  if (!filename || !pattern) return false;
  // Simple glob: only *.ext form supported
  if (pattern.startsWith('*')) {
    const ext = pattern.slice(1); // e.g. '.swift'
    return filename.endsWith(ext);
  }
  return filename === pattern;
}

/**
 * Check if a file path matches any configured file pattern.
 * @param {string} filePath
 * @param {string[]} patterns
 * @returns {boolean}
 */
function matchesFilePatterns(filePath, patterns) {
  if (!filePath || !patterns || patterns.length === 0) return false;
  const filename = path.basename(filePath);
  return patterns.some(p => matchesPattern(filename, p));
}

/**
 * Check if a file path matches any exempt path pattern.
 * @param {string} filePath
 * @param {string[]} exemptPatterns
 * @returns {boolean}
 */
function isExemptPath(filePath, exemptPatterns) {
  if (!filePath || !exemptPatterns || exemptPatterns.length === 0) return false;
  return exemptPatterns.some(ep => filePath.includes(ep));
}

/**
 * Compute "diff size" — length of new content (new_string or content).
 * @param {object} toolInput
 * @returns {number}
 */
function getDiffSize(toolInput) {
  if (!toolInput) return 0;
  const content = toolInput.new_string !== undefined
    ? toolInput.new_string
    : (toolInput.content || '');
  return content.length;
}

// ─── Parse stdin ───────────────────────────────────────────────────────────

/**
 * Parse PostToolUse stdin event JSON.
 * Returns { filePath, toolInput, diffSize } or null on error.
 */
function parseStdin(raw) {
  try {
    const event = JSON.parse(raw);
    const toolInput = event.tool_input || event.input || {};
    const filePath = toolInput.file_path || toolInput.path || null;
    const diffSize = getDiffSize(toolInput);
    return { filePath, toolInput, diffSize, event };
  } catch {
    return null;
  }
}

// ─── Tier 3 background spawn ───────────────────────────────────────────────

/**
 * Spawn a detached background process to run the LLM judge on the queue.
 * Hook returns immediately (exit 0) — result is written asynchronously.
 *
 * @param {string} queueFile     — absolute path to queue JSONL file
 * @param {string} resultsFile   — absolute path to results JSONL file
 * @param {object} policy        — full harness policy
 * @param {string} projectRoot   — resolved project root
 */
function spawnJudgeProcess(queueFile, resultsFile, policy, projectRoot) {
  // Inline runner script — avoids needing a separate file
  const runnerCode = `
'use strict';
// P1-3: Self-kill timeout — child runs detached, parent can't kill it.
// 90s ceiling: 60s API timeout + 2s retry backoff + buffer for parse/IO.
const SELF_TIMEOUT_MS = 90000;
const _selfKillTimer = setTimeout(() => {
  process.stderr.write('[inferential-judge-worker] self-timeout reached — exiting\\n');
  process.exit(0);
}, SELF_TIMEOUT_MS);
_selfKillTimer.unref();

const fs = require('fs');
const path = require('path');
const { reviewBatch } = require(${JSON.stringify(path.join(libDir, 'inferential-judge.cjs'))});
const { readQueue, clearQueue } = require(${JSON.stringify(path.join(libDir, 'inferential-queue.cjs'))});
const { trackRedSignal, trackViolation } = require(${JSON.stringify(path.join(libDir, 'harness-policy-loader.cjs'))});

const queueFile = ${JSON.stringify(queueFile)};
const resultsFile = ${JSON.stringify(resultsFile)};
const modelConfig = ${JSON.stringify(policy.inferential_review || {})};
const threshold = ${JSON.stringify((policy.inferential_review || {}).quality_score_threshold || 0.7)};

async function run() {
  try {
    const entries = readQueue(queueFile);
    if (entries.length === 0) return;
    clearQueue(queueFile);

    const result = await reviewBatch(entries, modelConfig);

    // Write result to results JSONL
    const dir = path.dirname(resultsFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // \`source\` is the difference between "reviewed and found nothing" and "never ran".
    // Without it, all 12 field rows read { overall_score: 1, issue_count: 0, issues: [] } and
    // nobody could tell that not one of them was a real review.
    const source = result.source || 'unknown';
    const record = {
      ts: Date.now(),
      overall_score: result.overall_score,
      source,
      ...(result.reason ? { reason: result.reason } : {}),
      file_count: entries.length,
      issue_count: result.issues.length,
      issues: result.issues,
      files: entries.map(e => e.file_path || e.filePath || '?')
    };
    fs.appendFileSync(resultsFile, JSON.stringify(record) + '\\n', 'utf8');

    // Only a real answered API call may feed the red-signal ladder. A fabricated score must
    // never escalate, and a row written before this change carries no \`source\` — 'unknown' is
    // not 'api', deliberately.
    if (source === 'api' && result.overall_score < threshold) {
      trackRedSignal('inferential_fail', {
        score: result.overall_score,
        threshold,
        file_count: entries.length,
        issue_count: result.issues.length
      });
      trackViolation({
        hook: 'inferential-review',
        violation_type: 'inferential_fail',
        severity: 'warning',
        blocked: false,
        context: {
          score: result.overall_score,
          threshold,
          issues: result.issues.slice(0, 5)
        }
      });
    }
  } catch (e) {
    process.stderr.write('[inferential-judge-worker] error: ' + e.message + '\\n');
  }
}

run().catch(() => {});
`;

  try {
    const child = spawn(process.execPath, ['--eval', runnerCode], {
      detached: true,
      stdio: 'ignore',
      env: process.env
    });
    child.unref();
  } catch (e) {
    process.stderr.write(`[${HOOK_NAME}] Failed to spawn judge process: ${e.message}\n`);
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const timer = createHookTimer(HOOK_NAME);
  /** End the timer and exit 0. Every exit from this hook goes through here. */
  const finish = (status, extra = {}) => {
    timer.end({ status, exit: 0, ...extra });
    process.exit(0);
  };

  // Read stdin via fd 0 (cross-platform, works with Node pipes)
  let stdinData = '';
  try {
    stdinData = fs.readFileSync(0, 'utf8');
  } catch {
    finish('error', { error: 'stdin_unreadable' });
  }

  if (!stdinData || !stdinData.trim()) finish('skipped', { error: 'empty_stdin' });

  // Bypass env
  if (process.env.BK_INFERENTIAL_SKIP === '1') finish('skipped');

  // Parse stdin
  const parsed = parseStdin(stdinData);
  if (!parsed) {
    // Malformed stdin — fail-open
    finish('error', { error: 'malformed_stdin' });
  }

  const { filePath, toolInput, diffSize } = parsed;
  if (!filePath) finish('skipped');

  // Load policy
  let policy;
  try {
    policy = loadHarnessPolicy();
  } catch {
    finish('error', { error: 'policy_load_failed' });
  }

  const cfg = policy.inferential_review;
  if (!cfg || !cfg.enabled) finish('skipped');

  const projectRoot = policy.__projectRoot;

  // ── Tier 1: Cheap precondition checks ────────────────────────────────────

  // Can a judge actually judge? Without ANTHROPIC_API_KEY (and outside mock mode) reviewBatch
  // can only fail open, so the whole pipeline downstream of here is a detached node process per
  // `batch_size` edits that produces a fabricated perfect score. That is what the field shows:
  // 12 of 12 result rows in both repos are byte-identical to DEFAULT_RESULT because neither repo
  // sets the key. Skipping the ENQUEUE as well as the spawn is the point — queueing without ever
  // spawning would grow the queue without bound.
  if (!isJudgeAvailable()) {
    finish('skipped', { error: 'judge_unavailable' });
  }

  // File pattern match
  const filePatterns = cfg.file_patterns || [];
  if (!matchesFilePatterns(filePath, filePatterns)) finish('skipped');

  // Exempt path check
  const exemptPatterns = cfg.exempt_path_patterns || [];
  if (isExemptPath(filePath, exemptPatterns)) finish('skipped');

  // Minimum diff size
  const minDiff = cfg.tier1_min_diff_chars || 20;
  if (diffSize < minDiff) finish('skipped');

  // Optional max file size check (from disk)
  const maxFileSize = cfg.tier1_max_file_size_bytes || 500000;
  try {
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      if (stat.size > maxFileSize) finish('skipped');
    }
  } catch { /* fail-open on stat error */ }

  // ── Tier 2: Enqueue edit ─────────────────────────────────────────────────

  const queueFile = resolveMetricPath(cfg.queue_file || '.bk-metrics/inferential-queue.jsonl', projectRoot);
  const resultsFile = resolveMetricPath(cfg.results_file || '.bk-metrics/inferential-results.jsonl', projectRoot);

  const entry = {
    file_path: filePath,
    diff_size: diffSize,
    tool: parsed.event && parsed.event.tool_name ? parsed.event.tool_name : 'Edit'
  };

  const enqueued = enqueueEdit(entry, queueFile);
  if (!enqueued) {
    // enqueue failed — fail-open
    finish('error', { error: 'enqueue_failed' });
  }

  // ── Check if batch threshold reached ─────────────────────────────────────

  const batchSize = cfg.batch_size || 5;
  const queueSize = getQueueSize(queueFile);

  if (queueSize >= batchSize) {
    // ── Tier 3: Spawn detached background LLM judge ───────────────────────
    process.stderr.write(`[${HOOK_NAME}] Queue at ${queueSize}/${batchSize} — triggering inferential review\n`);
    spawnJudgeProcess(queueFile, resultsFile, policy, projectRoot);
    finish('ok', { tool: 'judge_spawned' });
  }

  // Always exit 0 — never block agent
  finish('ok');
}

main().catch(err => {
  process.stderr.write(`[${HOOK_NAME}] Unexpected error (fail-open): ${err.message}\n`);
  process.exit(0);
});
