#!/usr/bin/env node
// anti-self-implementation.cjs - Division of Labor enforcement for conductor writes
// Trigger: PreToolUse (Write|Edit)
// Advisory only (exit 0 with additionalContext) — does NOT block writes

'use strict';

// Outer crash wrapper (catches require/parse failures)
try {
  const { createHookTimer } = require('./lib/hook-logger.cjs');
  const { getToolName } = require('./lib/hook-event-accessor.cjs');

  // Paths that conductor should delegate to agents
  const DELEGATION_PATHS = [
    {
      test: (p) => p.includes('mk/docs/foundation/') && !p.includes('mk/docs/foundation/_raw/'),
      agent: 'bk-docs-writer (via bk-bootstrap Step 5)'
    },
    {
      test: (p) => p.includes('/plan.md') && p.includes('mk/dev/'),
      agent: 'bk-planner (via bk-plan Step 8)'
    },
    {
      test: (p) => p.includes('/sub-task-') && p.includes('mk/dev/'),
      agent: 'bk-planner (via bk-plan Step 8)'
    },
    {
      test: (p) => p.includes('/phase-') && p.includes('mk/dev/'),
      agent: 'bk-planner (via bk-plan Step 8)'
    }
  ];

  // Paths conductor IS allowed to write directly
  const ALLOWED_WRITES = [
    (p) => p.endsWith('.workflow-state.json'),
    (p) => p.endsWith('.plan-state.json'),
    (p) => p.endsWith('.platform-context.json'),
    (p) => p.includes('/research/'),
    (p) => p.includes('/inputs/'),
    (p) => p.includes('mk/docs/foundation/_raw/'),
    (p) => p.includes('research-report-'),
    (p) => p.endsWith('-analysis.md')
  ];

  async function main() {
    const timer = createHookTimer('anti-self-implementation');
    try {
      const { isHookEnabled } = require('./lib/bk-config-utils.cjs');
      const { trackViolation } = require('./lib/harness-policy-loader.cjs');

      if (!isHookEnabled('anti-self-implementation')) {
        timer.end({ status: 'skipped', exit: 0 });
        process.exit(0);
      }

      // If caller is an agent (BK_AGENT_TYPE set), pass through silently
      if (process.env.BK_AGENT_TYPE) {
        timer.end({ status: 'agent_passthrough', exit: 0 });
        process.exit(0);
      }

      let input = '';
      for await (const chunk of process.stdin) input += chunk;
      const data = JSON.parse(input || '{}');

      const toolInput = data.tool_input || {};
      const filePath = toolInput.file_path || '';

      if (!filePath) {
        timer.end({ status: 'no_path', exit: 0 });
        process.exit(0);
      }

      // Normalize path separators for consistent matching
      const normalizedPath = filePath.replace(/\\/g, '/');

      // Check if path is in ALLOWED_WRITES — if so, pass through
      const isAllowed = ALLOWED_WRITES.some((check) => check(normalizedPath));
      if (isAllowed) {
        timer.end({ status: 'allowed', path: normalizedPath, exit: 0 });
        process.exit(0);
      }

      // Check if path matches a delegation target
      const match = DELEGATION_PATHS.find((entry) => entry.test(normalizedPath));
      if (match) {
        // Check if reactive signals are active — stronger warning
        let reactiveNote = '';
        try {
          const { readWorkflowState } = require('./lib/bk-config-utils.cjs');
          const state = readWorkflowState() || {};
          if (state.signal_count > 0 && state.last_signal) {
            reactiveNote = ` [CRITICAL] Reactive signals active (${state.last_signal.type} ×${state.signal_count}). Dispatch helper agent FIRST, do NOT implement directly.`;
          }
        } catch { /* best-effort */ }

        const warning =
          `[DIVISION-OF-LABOR] You are writing ${normalizedPath} directly. ` +
          `This should be delegated to ${match.agent}. ` +
          `Use Task(subagent_type="${match.agent.split(' ')[0]}", ...) instead.` +
          reactiveNote;

        process.stdout.write(JSON.stringify({
          additionalContext: warning
        }) + '\n');

        trackViolation({ hook: 'anti-self-implementation', violation_type: 'division_of_labor', tool: getToolName(data) || 'Write', target: filePath, blocked: false, severity: 'warning', context: { agent: match.agent } });
        timer.end({ status: 'warned', path: normalizedPath, agent: match.agent, exit: 0 });
        process.exit(0);
      }

      // No match — pass through
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
    try { const {appendJsonl: _ra} = require('./lib/jsonl-rotator.cjs'); _ra(p.join(logDir, 'hook-log.jsonl'), JSON.stringify({ ts: new Date().toISOString(), hook: 'anti-self-implementation', status: 'crash', error: e.message }) + '\n'); }
    catch(_e2) { fs.appendFileSync(p.join(logDir, 'hook-log.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), hook: 'anti-self-implementation', status: 'crash', error: e.message }) + '\n'); }
  } catch (_) {}
  process.exit(0);
}
