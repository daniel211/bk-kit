'use strict';
/**
 * verify-sensors.cjs — Ashby sensor verification engine.
 *
 * For each registered hook, runs a synthetic fixture that SHOULD trigger it,
 * then verifies the hook emits the expected signal.
 * Implements Ashby's Law of Requisite Variety: every detector must be proven to fire.
 *
 * @param {object} opts
 * @param {string} opts.projectRoot - project root (for resolving hook paths)
 * @param {string[]} [opts.only] - only run these sensor names
 * @param {boolean} [opts.fixtureOnly] - skip hooks that require git/network/long-running
 * @param {number} [opts.timeoutMs] - per-fixture timeout (default 10000)
 * @returns {{ total, passed, failed, skipped, results: object[] }}
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { getSensorFixtures } = require('./sensor-fixtures.cjs');

// ─── Project setup helper ─────────────────────────────────────────────────────

/**
 * Create a temporary project directory populated with fixture files.
 * @param {object} files - { relPath: content } map
 * @returns {string} temp dir path
 */
function setupFixtureProject(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-sensor-verify-'));
  fs.mkdirSync(path.join(root, '.bk-metrics'), { recursive: true });
  fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(root, 'mk', 'dev', 'shared'), { recursive: true });

  // Write default .bk.json to enable hooks
  const mkJson = path.join(root, '.claude', '.bk.json');
  if (!files['.claude/.bk.json']) {
    fs.writeFileSync(mkJson, JSON.stringify({ hooks: {} }), 'utf8');
  }

  // Write fixture files
  for (const [relPath, content] of Object.entries(files || {})) {
    const absPath = path.join(root, relPath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, content, 'utf8');
  }

  return root;
}

/**
 * Resolve hook path from hookName relative to hooks/_base.
 * @param {string} hookName - e.g. "token-burn-detector.cjs"
 * @param {string} projectRoot
 * @returns {string|null} absolute path to hook .cjs
 */
function resolveHookPath(hookName, projectRoot) {
  const candidates = [
    // Installed kit
    path.join(projectRoot, '.claude', 'hooks', hookName),
    // Dev-mode
    path.join(projectRoot, 'src', 'hooks', '_base', hookName),
    // Relative to this file (also dev-mode)
    path.join(__dirname, '..', '..', '..', 'hooks', '_base', hookName)
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Check if a JSONL file was written/modified by checking its mtime and content.
 * @param {string} dir - project root
 * @param {string} filename - .bk-metrics/*.jsonl filename
 * @param {number} beforeMs - timestamp before hook ran
 * @returns {boolean}
 */
function checkJsonlWritten(dir, filename, beforeMs) {
  try {
    const p = path.join(dir, '.bk-metrics', filename);
    if (!fs.existsSync(p)) return false;
    const stat = fs.statSync(p);
    return stat.mtimeMs >= beforeMs - 100;  // 100ms tolerance
  } catch { return false; }
}

/**
 * Check if a red signal of given type appears in red-signals.jsonl.
 * @param {string} dir - project root
 * @param {string} signalType
 * @param {number} afterMs - only consider entries after this timestamp
 * @returns {boolean}
 */
function checkRedSignal(dir, signalType, afterMs) {
  try {
    const p = path.join(dir, '.bk-metrics', 'red-signals.jsonl');
    if (!fs.existsSync(p)) return false;
    const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
    return lines.some(l => {
      try {
        const e = JSON.parse(l);
        return e.type === signalType && (e.ts || 0) >= afterMs;
      } catch { return false; }
    });
  } catch { return false; }
}

// ─── Main verifier ────────────────────────────────────────────────────────────

/**
 * Run all sensor fixtures and collect results.
 * @param {object} opts
 * @returns {{ total, passed, failed, skipped, results }}
 */
function verifySensors(opts = {}) {
  const { projectRoot, only, fixtureOnly = false, timeoutMs = 10000 } = opts;

  const fixtures = getSensorFixtures().filter(f => {
    if (only && only.length > 0) {
      return only.includes(f.displayName) || only.includes(f.hookName);
    }
    return true;
  });

  const results = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  for (const fixture of fixtures) {
    const result = runFixture(fixture, projectRoot, { timeoutMs, fixtureOnly });
    results.push(result);
    if (result.status === 'pass') passed++;
    else if (result.status === 'fail') failed++;
    else skipped++;
  }

  return {
    total: fixtures.length,
    passed,
    failed,
    skipped,
    results
  };
}

/**
 * Run a single sensor fixture.
 * @param {object} fixture
 * @param {string} projectRoot
 * @param {object} runOpts
 * @returns {object} result entry
 */
function runFixture(fixture, projectRoot, runOpts = {}) {
  const { timeoutMs = 10000 } = runOpts;
  const startMs = Date.now();

  // Resolve hook path
  const hookPath = resolveHookPath(fixture.hookName, projectRoot);

  if (!hookPath) {
    return {
      hookName: fixture.displayName,
      status: 'skip',
      reason: `Hook not found: ${fixture.hookName}`,
      elapsed: Date.now() - startMs
    };
  }

  // Create temp project
  let tmpDir;
  try {
    tmpDir = setupFixtureProject(fixture.fixture.files || {});
  } catch (err) {
    return {
      hookName: fixture.displayName,
      status: 'fail',
      reason: `Setup failed: ${err.message}`,
      elapsed: Date.now() - startMs
    };
  }

  const beforeMs = Date.now();

  try {
    // Build env
    const env = {
      ...process.env,
      BK_PROJECT_ROOT: tmpDir,
      BK_HARNESS_POLICY_PATH: '/nonexistent/policy.json',
      BK_HOOK_LOG_DISABLED: '1',
      BK_HOOK_TIMER_DISABLED: '1',
      ...(fixture.fixture.env || {})
    };

    // Serialize input
    const stdin = JSON.stringify(fixture.fixture.input || {});

    // Spawn hook
    const proc = spawnSync(process.execPath, [hookPath], {
      input: stdin,
      env,
      cwd: tmpDir,
      timeout: timeoutMs,
      encoding: 'utf8'
    });

    const elapsed = Date.now() - startMs;
    const exitCode = proc.status ?? (proc.signal ? 128 : 0);
    const stdout = proc.stdout || '';
    const stderr = proc.stderr || '';

    // Check expectations
    const expected = fixture.expected || {};
    const failures = [];

    // Check exit code
    if (expected.exitCode !== undefined && exitCode !== expected.exitCode) {
      failures.push(`exitCode: expected ${expected.exitCode}, got ${exitCode}`);
    }

    // Check red signal
    if (expected.redSignal) {
      const found = checkRedSignal(tmpDir, expected.redSignal, beforeMs);
      if (!found) {
        failures.push(`redSignal: expected ${expected.redSignal} in red-signals.jsonl`);
      }
    }

    // Check JSONL write
    if (expected.jsonlWrite) {
      const written = checkJsonlWritten(tmpDir, expected.jsonlWrite, beforeMs);
      if (!written) {
        failures.push(`jsonlWrite: expected write to .bk-metrics/${expected.jsonlWrite}`);
      }
    }

    // Check stdout
    if (expected.stdoutContains) {
      if (!stdout.includes(expected.stdoutContains)) {
        failures.push(`stdout: expected to contain "${expected.stdoutContains}"`);
      }
    }

    // Check stderr
    if (expected.stderrContains) {
      if (!stderr.includes(expected.stderrContains)) {
        failures.push(`stderr: expected to contain "${expected.stderrContains}"`);
      }
    }

    const status = failures.length === 0 ? 'pass' : 'fail';

    return {
      hookName: fixture.displayName,
      category: fixture.category,
      status,
      failures,
      exitCode,
      elapsed,
      stderr: stderr.slice(0, 500),
      stdout: stdout.slice(0, 200)
    };

  } finally {
    // Cleanup temp dir
    try { require('fs').rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

/**
 * Render sensor verification results as a formatted string.
 * @param {{ total, passed, failed, skipped, results }} verifyResult
 * @returns {string}
 */
function renderVerifySensors(verifyResult) {
  const { total, passed, failed, skipped, results } = verifyResult;
  const isTTY = process.stdout.isTTY;
  const RED    = isTTY ? '\x1b[31m' : '';
  const GREEN  = isTTY ? '\x1b[32m' : '';
  const YELLOW = isTTY ? '\x1b[33m' : '';
  const RESET  = isTTY ? '\x1b[0m'  : '';
  const BOLD   = isTTY ? '\x1b[1m'  : '';

  const lines = [];
  lines.push(`\n${BOLD}Harness Sensor Verification — ${passed}/${total} sensors OK${RESET}`);
  if (skipped > 0) lines.push(`  (${skipped} skipped — hook not found)`);
  lines.push('');

  for (const r of results) {
    if (r.status === 'pass') {
      const detail = r.failures?.length === 0
        ? `exit ${r.exitCode} OK`
        : '';
      lines.push(`  ${GREEN}✓${RESET} ${r.hookName.padEnd(35)} → ${detail}`);
    } else if (r.status === 'skip') {
      lines.push(`  ${YELLOW}⊘${RESET} ${r.hookName.padEnd(35)} → SKIPPED: ${r.reason}`);
    } else {
      lines.push(`  ${RED}✗${RESET} ${r.hookName.padEnd(35)} → FAILED`);
      for (const f of r.failures || []) {
        lines.push(`      ${RED}↳${RESET} ${f}`);
      }
      if (r.stderr) {
        lines.push(`      stderr: ${r.stderr.slice(0, 120)}`);
      }
    }
  }

  lines.push('');
  const overall = failed > 0
    ? `${RED}✗ FAILED${RESET} — ${failed} sensor(s) did not fire`
    : `${GREEN}✓ ALL SENSORS OK${RESET}`;
  lines.push(overall);

  return lines.join('\n');
}

module.exports = { verifySensors, runFixture, renderVerifySensors };
