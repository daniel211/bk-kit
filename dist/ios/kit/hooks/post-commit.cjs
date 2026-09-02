#!/usr/bin/env node
// post-commit.cjs - Update workflow state phase to "commit" after git commit
// Trigger: PostToolUse (Bash) — fires only when bash command contains "git commit"
// Rewritten from package/.claude/hooks/post-commit-handler.sh

'use strict';

// Outer crash wrapper (catches require/parse failures)
try {
  const { createHookTimer } = require('./lib/hook-logger.cjs');

  async function main() {
    const timer = createHookTimer('post-commit');
    try {
      const { isHookEnabled, readWorkflowState, writeWorkflowState } = require('./lib/bk-config-utils.cjs');

      if (!isHookEnabled('post-commit')) {
        timer.end({ status: 'skipped', exit: 0 });
        process.exit(0);
      }

      let input = '';
      for await (const chunk of process.stdin) input += chunk;
      const data = JSON.parse(input || '{}');

      const toolInput = data.tool_input || {};
      const toolResponse = data.tool_response || {};

      // Only act on git commit commands
      const command = toolInput.command || '';
      if (!command.includes('git commit')) {
        timer.end({ status: 'ok', exit: 0 });
        process.exit(0);
      }

      // Check commit succeeded — output contains "[branch hash]" pattern
      const output = typeof toolResponse === 'string'
        ? toolResponse
        : (toolResponse.stdout || JSON.stringify(toolResponse));

      const commitSucceeded = /\[.+\s[a-f0-9]+\]/.test(output);
      if (!commitSucceeded) {
        timer.end({ status: 'ok', exit: 0 });
        process.exit(0);
      }

      // Extract commit hash from output if available
      const hashMatch = output.match(/\[.+\s([a-f0-9]+)\]/);
      const commitHash = hashMatch ? hashMatch[1] : null;

      // Update workflow state phase
      const state = readWorkflowState();
      if (!state) {
        timer.end({ status: 'ok', exit: 0 });
        process.exit(0);
      }

      const phaseHistory = Array.isArray(state.phase_history) ? state.phase_history : [];
      phaseHistory.push({
        from: state.current_phase || null,
        to: 'commit',
        timestamp: new Date().toISOString()
      });
      // Cap history at 20 entries to prevent unbounded growth
      if (phaseHistory.length > 20) phaseHistory.splice(0, phaseHistory.length - 20);

      writeWorkflowState({
        current_phase: 'commit',
        phase_history: phaseHistory,
        ...(commitHash ? { last_commit_hash: commitHash } : {})
      });

      process.stdout.write(JSON.stringify({
        additionalContext: `[POST-COMMIT] Workflow phase updated to "committed"${commitHash ? ` (${commitHash})` : ''}. Feature "${state.feature || 'unknown'}" committed successfully.`
      }) + '\n');

      timer.end({ status: 'ok', exit: 0 });
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
    try { const {appendJsonl: _ra} = require('./lib/jsonl-rotator.cjs'); _ra(p.join(logDir, 'hook-log.jsonl'), JSON.stringify({ ts: new Date().toISOString(), hook: 'post-commit', status: 'crash', error: e.message }) + '\n'); }
    catch(_e2) { fs.appendFileSync(p.join(logDir, 'hook-log.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), hook: 'post-commit', status: 'crash', error: e.message }) + '\n'); }
  } catch (_) {}
  process.exit(0);
}
