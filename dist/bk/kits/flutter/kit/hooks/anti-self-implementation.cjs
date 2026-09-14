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
      test: (p) => p.includes('bk/docs/foundation/') && !p.includes('bk/docs/foundation/_raw/'),
      agent: 'bk-docs-writer (via bk-bootstrap Step 5)'
    },
    {
      test: (p) => p.includes('/plan.md') && p.includes('bk/dev/'),
      agent: 'bk-planner (via bk-plan Step 8)'
    },
    {
      test: (p) => p.includes('/sub-task-') && p.includes('bk/dev/'),
      agent: 'bk-planner (via bk-plan Step 8)'
    },
    {
      test: (p) => p.includes('/phase-') && p.includes('bk/dev/'),
      agent: 'bk-planner (via bk-plan Step 8)'
    }
  ];

  // Paths conductor IS allowed to write directly
  const ALLOWED_WRITES = [
    (p) => p.endsWith('.workflow-state.json'),
    (p) => p.endsWith('.plan-state.json'),
    (p) => p.endsWith('platform-context.json'),
    (p) => p.includes('/research/'),
    (p) => p.includes('/inputs/'),
    (p) => p.includes('bk/docs/foundation/_raw/'),
    (p) => p.includes('research-report-'),
    (p) => p.endsWith('-analysis.md')
  ];

  /**
   * Is this write coming from a subagent rather than the conductor?
   *
   * The hook fires on every Write/Edit, subagents included, and its whole premise is that the
   * writer is the conductor skipping delegation. When a subagent writes, the advice inverts
   * into nonsense: bk-planner writing its own plan.md is told to "delegate to bk-planner".
   *
   * The old guard read `BK_AGENT_TYPE`, which nothing in the kit ever sets — a hook cannot
   * export an env var to the hook processes that follow it — so it never fired once, and
   * every subagent write was charged to the conductor. Field evidence: 37 warnings raised
   * against `bk/dev/` plan files, while the conductor's own transcripts contain 6 Write/Edit
   * calls in total and the subagent transcripts contain 56 to exactly those paths.
   *
   * Signals, cheapest first:
   *  - `BK_AGENT_TYPE`, still honoured for anything that does set it;
   *  - `agent_type` / `agent_id` on the payload — the CLI supplies both;
   *  - `agent_transcript_path`, or a `transcript_path` under `<session>/subagents/`, which is
   *    where a subagent's own transcript lives.
   *
   * Confirmed in the field: a measured session ran 19 Write/Edit dispatches through this hook,
   * every one of them from a subagent (bk-unit-test-agent and bk-gemini-reviewer, matched by
   * timestamp against their dispatch windows), and hook-log.jsonl records all 19 as
   * `agent_passthrough`. The payload does carry the identity.
   */
  function isAgentContext(data) {
    if (process.env.BK_AGENT_TYPE) return true;
    if (data && (data.agent_type || data.agent_id)) return true;
    const transcript = String(
      (data && (data.agent_transcript_path || data.transcript_path)) || ''
    ).replace(/\\/g, '/');
    return transcript.includes('/subagents/');
  }

  async function main() {
    const timer = createHookTimer('anti-self-implementation');
    try {
      const { isHookEnabled } = require('./lib/bk-config-utils.cjs');
      const { trackViolation } = require('./lib/harness-policy-loader.cjs');

      if (!isHookEnabled('anti-self-implementation')) {
        timer.end({ status: 'skipped', exit: 0 });
        process.exit(0);
      }

      let input = '';
      for await (const chunk of process.stdin) input += chunk;
      const data = JSON.parse(input || '{}');

      // Delegation advice is for the conductor. A subagent writing its own deliverable is
      // doing its job — see isAgentContext.
      if (isAgentContext(data)) {
        timer.end({ status: 'agent_passthrough', exit: 0 });
        process.exit(0);
      }

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
  // A DispatchExit is this hook's own process.exit() unwinding under bk-dispatch, not a
  // crash. Logging it here is how a clean run got filed as `status: "crash"`.
  if (e && e.bkDispatchExit) throw e;

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
