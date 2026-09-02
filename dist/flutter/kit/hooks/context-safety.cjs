#!/usr/bin/env node
// context-safety.cjs - Block Task dispatch when context usage exceeds 85%
// Trigger: PreToolUse (Task)
// Rewritten from package/.claude/hooks/context-safety.sh

'use strict';

// Outer crash wrapper (catches require/parse failures)
try {
  const { createHookTimer } = require('./lib/hook-logger.cjs');
  const fs = require('fs');
  const path = require('path');
  const { isHookEnabled } = require('./lib/bk-config-utils.cjs');
  const { resolveProjectRoot } = require('./lib/resolve-project-root.cjs');

  async function main() {
    const timer = createHookTimer('context-safety');
    try {
      if (!isHookEnabled('context-safety')) {
        timer.end({ status: 'skipped', exit: 0 });
        process.exit(0);
      }

      let input = '';
      for await (const chunk of process.stdin) input += chunk;
      const data = JSON.parse(input || '{}');

      const cwd = resolveProjectRoot();

      // P2-rec: separate "trusted" data (cache/state — can BLOCK) from
      // "heuristic" data (history-length estimate — only ADVISORY).
      // Rationale: a heuristic-derived 86% should not block dispatch when no
      // canonical context_pct exists; only real measurements gate critical actions.
      let contextPct = 0;
      let source = 'none';  // 'cache' | 'heuristic' | 'none'

      const candidates = [
        path.join(cwd, 'mk', 'dev', 'shared', '.statusline-cache.json'),
        path.join(cwd, 'mk', 'dev', 'shared', '.workflow-state.json')
      ];

      for (const filePath of candidates) {
        try {
          if (fs.existsSync(filePath)) {
            const stat = fs.statSync(filePath);
            const ageMs = Date.now() - stat.mtimeMs;
            const isStale = ageMs > 60000; // >60s = stale

            const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            if (typeof parsed.context_pct === 'number' && parsed.context_pct > 0) {
              contextPct = parsed.context_pct;
              source = 'cache';
              if (isStale) {
                // Stale cache — add 10% buffer as precaution
                contextPct = Math.min(100, contextPct + 10);
              }
              break;
            }
          }
        } catch { /* skip */ }
      }

      // --- Task 3.2A: Fallback when statusline cache is unavailable ---
      // Heuristic estimate is ADVISORY only — never used to block dispatch.
      if (contextPct === 0 || isNaN(contextPct)) {
        if (data.conversation_history_length) {
          // Rough estimate: 1 message ≈ 500 tokens, context window ≈ 200K
          contextPct = Math.min(100, (data.conversation_history_length * 500 / 200000) * 100);
          source = 'heuristic';
        }
      }

      if (contextPct === 0) {
        // No cache data and no fallback — exit silently instead of injecting noise (CR-P2-01)
        timer.end({ status: 'no_data', exit: 0 });
        process.exit(0);
      }

      // Block at >85% ONLY when source is trusted (cache/state). Heuristic → demote to warn.
      if (contextPct > 85 && source === 'cache') {
        const guidance = [
          'Context window is at ' + contextPct.toFixed(0) + '% capacity.',
          'ACTION REQUIRED:',
          '- Save current progress to plan files',
          '- Use /compact to compress context',
          '- Resume from saved state after compaction',
          'Dispatch blocked to prevent context overflow.'
        ].join('\n');
        process.stdout.write(guidance);
        process.stderr.write(
          `[CONTEXT-SAFETY] Context at ${contextPct}% — agent dispatch BLOCKED.\n` +
          `Save a checkpoint and compact context before dispatching more agents.\n`
        );
        timer.end({ status: 'blocked', tool: `context-${contextPct}%`, exit: 2 });
        process.exit(2);
      }

      // Warn at >70%, OR demote a >85% heuristic-only signal to warn (advisory).
      if (contextPct > 70) {
        const demoted = contextPct > 85 && source !== 'cache';
        const tag = demoted ? '[CONTEXT-WARN-HEURISTIC]' : '[CONTEXT-WARN]';
        const note = demoted
          ? ' (heuristic estimate — install statusline cache for blocking guarantee)'
          : '';
        process.stdout.write(JSON.stringify({
          additionalContext: `${tag} Context at ${contextPct.toFixed(0)}%${note}. Consider saving a checkpoint before dispatching more agents.`
        }) + '\n');
      }

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
    try { const {appendJsonl: _ra} = require('./lib/jsonl-rotator.cjs'); _ra(p.join(logDir, 'hook-log.jsonl'), JSON.stringify({ ts: new Date().toISOString(), hook: 'context-safety', status: 'crash', error: e.message }) + '\n'); }
    catch(_e2) { fs.appendFileSync(p.join(logDir, 'hook-log.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), hook: 'context-safety', status: 'crash', error: e.message }) + '\n'); }
  } catch (_) {}
  // Fail-open on infrastructure errors (require/parse failures).
  // Context safety blocking only happens inside main() where logic runs.
  process.exit(0);
}
