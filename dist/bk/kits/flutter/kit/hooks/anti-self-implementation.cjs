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
    // Payload signals shared with conductor-inbox-drain — see lib/hook-caller-context.cjs.
    return require('./lib/hook-caller-context.cjs').isSubagentEvent(data);
  }

  /**
   * Is this a small metadata Edit to a plan document that the bk-plan / bk-code skills tell the
   * conductor to make itself?
   *
   * Sanctioned: flipping `status:` / `validated:` / `execution:` frontmatter keys (archive,
   * validate and parallel modes), updating a Sub-Tasks table status cell (task hydration), and
   * ticking a `[ ]` checkbox. Those are bookkeeping on a document bk-planner authored, not
   * synthesis. Full `Write`s and large or prose `Edit`s still count as self-implementation.
   * Only plan documents reach this check (see DELEGATION_PATHS), never source files.
   */
  const METADATA_EDIT_MAX_CHARS = 300;
  function isSanctionedMetadataEdit(toolName, toolInput) {
    if (toolName !== 'Edit') return false;
    const oldStr = typeof toolInput.old_string === 'string' ? toolInput.old_string : '';
    const newStr = typeof toolInput.new_string === 'string' ? toolInput.new_string : '';
    if (!oldStr || oldStr.length > METADATA_EDIT_MAX_CHARS || newStr.length > METADATA_EDIT_MAX_CHARS) return false;
    const lines = `${oldStr}\n${newStr}`.split('\n').map((l) => l.trim()).filter(Boolean);
    const isMetaLine = (l) =>
      /^(status|validated|execution|updated|completed|archived)\s*:/i.test(l) || // frontmatter key
      /^\|.*\|$/.test(l) ||                                                       // table row
      /^[-*]\s*\[[ xX]\]/.test(l);                                                // checkbox
    return lines.length > 0 && lines.every(isMetaLine);
  }

  /**
   * bk-plan Step 9/10 have the conductor record the critic scoring table in `## Critic Review` and
   * the interview answers in `## Validation Log` (critic-review.md, validate-interview.md). That is
   * transcription of agent/user output, not plan synthesis. Sanctioned only when the Edit's new text
   * carries one of those headings and the old text is a lone heading anchor or touches no other `##` section.
   */
  const RECORD_EDIT_MAX_CHARS = 4000;
  const RECORD_HEADING = /^#{2,3}\s+(Critic Review|Validation Log|Session \d+)\b/m;
  function isSanctionedRecordEdit(toolName, toolInput) {
    if (toolName !== 'Edit') return false;
    const oldStr = typeof toolInput.old_string === 'string' ? toolInput.old_string : '';
    const newStr = typeof toolInput.new_string === 'string' ? toolInput.new_string : '';
    if (newStr.length > RECORD_EDIT_MAX_CHARS || oldStr.length > RECORD_EDIT_MAX_CHARS) return false;
    if (!RECORD_HEADING.test(newStr)) return false;
    // Anchor-only old text (a lone heading line kept in the new text) is an insertion, not a rewrite.
    const anchor = oldStr.trim();
    if (!anchor.includes('\n') && /^##\s/.test(anchor)) return newStr.includes(anchor);
    return !/^##\s+(?!(Critic Review|Validation Log)\b)/m.test(oldStr);
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
      if (match && (isSanctionedMetadataEdit(getToolName(data), toolInput) || isSanctionedRecordEdit(getToolName(data), toolInput))) {
        timer.end({ status: 'sanctioned_metadata_edit', path: normalizedPath, exit: 0 });
        process.exit(0);
      }
      if (match) {
        // Check if reactive signals are active — stronger warning
        let reactiveNote = '';
        try {
          const { readWorkflowState } = require('./lib/bk-config-utils.cjs');
          const state = readWorkflowState() || {};
          if (state.signal_count > 0 && state.last_signal) {
            reactiveNote = ` [CRITICAL] Signals active (${state.last_signal.type} ×${state.signal_count}) — dispatch the helper first.`;
          }
        } catch { /* best-effort */ }

        const warning =
          `[DIVISION-OF-LABOR] Conductor ${getToolName(data) || 'Write'} on ${normalizedPath}: this content belongs to ${match.agent}. ` +
          `Dispatch Task(subagent_type="${match.agent.split(' ')[0]}", ...) with the change as instructions (e.g. critic REVISE fixes, validate answers). ` +
          `Conductor may edit plan docs directly only for status/checkbox/table-cell flips and the ## Critic Review / ## Validation Log records.` +
          reactiveNote;

        // Advisory context is subject to the shared injection budget (cap + dedupe).
        // Optional lib: if absent the warning goes out unchanged.
        let text = warning;
        try {
          const injectionBudget = require('./lib/injection-budget.cjs');
          text = injectionBudget.prepareInjection('anti-self-implementation', warning, {
            sessionId: injectionBudget.sessionIdFrom(data)
          });
        } catch { /* optional lib — keep the full text */ }

        if (text) {
          process.stdout.write(JSON.stringify({ additionalContext: text }) + '\n');
        }

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
