#!/usr/bin/env node
// checkpoint-save.cjs - Save workflow checkpoint on Stop/PreCompact
// Trigger: Stop, PreCompact
// Purpose: Capture workflow + git state for reliable resume after compaction

'use strict';

// Outer crash wrapper (catches require/parse failures)
try {
  const { createHookTimer } = require('./lib/hook-logger.cjs');
  const { execFileSync } = require('child_process');

  /** Run a git command safely, return trimmed output or null */
  function gitSafe(...args) {
    try { return execFileSync('git', args, { encoding: 'utf8', timeout: 5000 }).trim(); } catch { return null; }
  }

  async function main() {
    const timer = createHookTimer('checkpoint-save');
    try {
      const { isHookEnabled, readWorkflowState, saveCheckpoint } = require('./lib/bk-config-utils.cjs');

      if (!isHookEnabled('checkpoint-save')) {
        timer.end({ status: 'skipped', exit: 0 });
        process.exit(0);
      }

      // Read current workflow state
      const state = readWorkflowState() || {};

      // Read git state (execFileSync avoids shell injection)
      const branch = gitSafe('rev-parse', '--abbrev-ref', 'HEAD');
      const commitHash = gitSafe('rev-parse', '--short', 'HEAD');
      const porcelain = gitSafe('status', '--porcelain');
      const hasUncommitted = porcelain !== null && porcelain.length > 0;

      // Build checkpoint
      const checkpoint = {
        version: 1,
        timestamp: new Date().toISOString(),
        workflow: {
          command: state.command || null,
          feature: state.feature || null,
          current_phase: state.current_phase || null,
          phase_history: state.phase_history || [],
          complexity_tier: state.complexity_tier || 'Standard',
          quality_fix_count: state.quality_fix_count || 0,
          skills_loaded: state.skills_loaded || []
        },
        git: {
          branch: branch || null,
          commit_hash: commitHash || null,
          has_uncommitted: hasUncommitted
        },
        platform: process.env.BK_PLATFORM || state.platform || 'unknown'
      };

      const saved = saveCheckpoint(checkpoint);
      timer.end({ status: saved ? 'ok' : 'write-failed', exit: 0 });
      process.exit(0);
    } catch (err) {
      timer.end({ status: 'error', error: err.message, exit: 0 });
      process.exit(0);
    }
  }
  main();
} catch (e) {
  try {
    const fs = require('fs');
    const p = require('path');
    const logDir = p.join(__dirname, '.logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    try { const {appendJsonl: _ra} = require('./lib/jsonl-rotator.cjs'); _ra(p.join(logDir, 'hook-log.jsonl'), JSON.stringify({ ts: new Date().toISOString(), hook: 'checkpoint-save', status: 'crash', error: e.message }) + '\n'); }
    catch(_e2) { fs.appendFileSync(p.join(logDir, 'hook-log.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), hook: 'checkpoint-save', status: 'crash', error: e.message }) + '\n'); }
  } catch (_) {}
  process.exit(0);
}
