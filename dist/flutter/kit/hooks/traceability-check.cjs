#!/usr/bin/env node
// traceability-check.cjs - Warn if traceability coverage is low before commit
// Trigger: PreToolUse (matcher: Task) — fires when dispatching agents
// Purpose: Read traceability-matrix.md, warn if coverage < 80% before bk-git-manager
// Non-blocking (exit 0). Fail-open always.

'use strict';

// Outer crash wrapper
try {
  const { createHookTimer } = require('./lib/hook-logger.cjs');
  const fs = require('fs');
  const path = require('path');
  const { resolveProjectRoot } = require('./lib/resolve-project-root.cjs');
  const { getDispatchTarget } = require('./lib/hook-event-accessor.cjs');

  async function main() {
    const timer = createHookTimer('traceability-check');
    try {
      const { isHookEnabled } = require('./lib/bk-config-utils.cjs');

      if (!isHookEnabled('traceability-check')) {
        timer.end({ status: 'skipped', exit: 0 });
        process.exit(0);
      }

      let input = '';
      for await (const chunk of process.stdin) input += chunk;
      const data = JSON.parse(input || '{}');
      // RC-2: getDispatchTarget returns subagent_type for Task events, tool name otherwise.
      const dispatchTarget = (getDispatchTarget(data) || '').toLowerCase();

      // Only fire when dispatching bk-git-manager (or any *-git-manager variant)
      if (!dispatchTarget.includes('git-manager')) {
        timer.end({ status: 'skip_non_git', exit: 0 });
        process.exit(0);
      }

      // Find latest feature directory in mk/dev/
      const devDir = path.join(resolveProjectRoot(), 'mk', 'dev');
      if (!fs.existsSync(devDir)) {
        timer.end({ status: 'no_specs_dir', exit: 0 });
        process.exit(0);
      }

      const dirs = fs.readdirSync(devDir, { withFileTypes: true })
        .filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'shared' && e.name !== 'archive')
        .sort((a, b) => a.name < b.name ? 1 : -1);

      let matrixContent = null;
      let matrixFeature = null;

      for (const dir of dirs) {
        const matrixPath = path.join(devDir, dir.name, 'traceability-matrix.md');
        if (fs.existsSync(matrixPath)) {
          matrixContent = fs.readFileSync(matrixPath, 'utf8');
          matrixFeature = dir.name;
          break;
        }
      }

      // No matrix file — silently pass
      if (!matrixContent) {
        timer.end({ status: 'no_matrix', exit: 0 });
        process.exit(0);
      }

      // Parse coverage percentage from matrix (e.g. "Coverage: 75%" or "Coverage = 75%")
      const coverageMatch = matrixContent.match(/[Cc]overage[:\s=]+(\d+(?:\.\d+)?)\s*%/);
      if (!coverageMatch) {
        timer.end({ status: 'no_coverage_line', exit: 0 });
        process.exit(0);
      }

      const coverage = parseFloat(coverageMatch[1]);

      if (coverage >= 80) {
        timer.end({ status: 'ok', coverage, exit: 0 });
        process.exit(0);
      }

      // Find uncovered REQ IDs (rows with ❌)
      const uncoveredLines = matrixContent.split('\n')
        .filter(l => l.includes('❌'))
        .map(l => {
          const match = l.match(/REQ-[\w-]+/);
          return match ? match[0] : null;
        })
        .filter(Boolean);

      const warning = [
        `[TRACEABILITY-WARNING] Coverage: ${coverage.toFixed(0)}% (threshold: 80%) — Feature: ${matrixFeature}`,
        `Uncovered requirements: ${uncoveredLines.join(', ') || 'see traceability-matrix.md'}`,
        `Consider implementing missing requirements or updating traceability-matrix.md before commit.`
      ].join('\n');

      process.stdout.write(JSON.stringify({ additionalContext: warning }) + '\n');

      timer.end({ status: 'warned', coverage, uncovered: uncoveredLines.length, exit: 0 });
      process.exit(0);
    } catch (err) {
      timer.end({ status: 'error', error: err.message, exit: 0 });
      process.exit(0); // Fail-open
    }
  }
  main();
} catch (e) {
  try {
    const fs = require('fs');
    const p = require('path');
    const logDir = p.join(__dirname, '.logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    try { const {appendJsonl: _ra} = require('./lib/jsonl-rotator.cjs'); _ra(p.join(logDir, 'hook-log.jsonl'), JSON.stringify({ ts: new Date().toISOString(), hook: 'traceability-check', status: 'crash', error: e.message }) + '\n'); }
    catch(_e2) { fs.appendFileSync(p.join(logDir, 'hook-log.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), hook: 'traceability-check', status: 'crash', error: e.message }) + '\n'); }
  } catch (_) {}
  process.exit(0); // Fail-open
}
