#!/usr/bin/env node
// conductor-inbox-drain.cjs - Deliver what SubagentStop hooks queued for the conductor
// Trigger: PreToolUse (*), PostToolUse (*), UserPromptSubmit — main session only
//
// verify-output and agent-signal-detector judge a finished agent at SubagentStop, whose output
// never reaches the main conversation (lib/conductor-inbox.cjs has the transcript evidence).
// They queue their rejections and signals in the session's inbox; this hook hands them over on
// the next event the conductor actually sees.
//
// Why three events: with background agents the conductor learns an agent finished from a task
// notification, which may not fire UserPromptSubmit at all. SubagentStop fires before the
// conductor's next tool round, so the next PreToolUse — or PostToolUse, whichever comes first —
// carries the message. UserPromptSubmit covers the conductor that ended its turn in prose. The
// inbox is claimed by rename, so whichever event fires first delivers and the rest find nothing.
//
// Output shape matters. A bare top-level `{additionalContext}` on PreToolUse/PostToolUse is
// recorded in the transcript as a `hook_success` attachment with `content: ""` — stored, never
// shown to the model. Measured in X-Game-Pro's main transcripts: 33 PostToolUse hook_success
// rows, all with empty content, and the old `[AGENT-OUTPUT-REJECTED] … failed 10x` text lives
// only in their `stdout` field. What the model does receive is a `hook_additional_context`
// attachment, produced by `hookSpecificOutput: { hookEventName, additionalContext }` (166
// PreToolUse and 5 PostToolUse such rows across recent transcripts). UserPromptSubmit plain
// stdout is delivered as-is, as lint-findings-inject relies on.
//
// Never blocks. Always exits 0.

'use strict';

try {
  const { createHookTimer } = require('./lib/hook-logger.cjs');

  const DRAIN_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'UserPromptSubmit']);

  async function main() {
    const timer = createHookTimer('conductor-inbox-drain');
    try {
      const { isHookEnabled } = require('./lib/bk-config-utils.cjs');
      if (!isHookEnabled('conductor-inbox-drain')) {
        timer.end({ status: 'skipped', exit: 0 });
        process.exit(0);
      }

      let input = '';
      for await (const chunk of process.stdin) input += chunk;
      const data = JSON.parse(input || '{}');

      const event = data.hook_event_name || '';
      const sessionId = data.session_id || data.sessionId || null;
      if (!DRAIN_EVENTS.has(event) || !sessionId) {
        timer.end({ status: 'not_applicable', exit: 0 });
        process.exit(0);
      }

      // A subagent's own tool calls fire PreToolUse/PostToolUse with the parent's session_id.
      // Draining there would hand the conductor's messages to the subagent — and consume them.
      const { isSubagentEvent } = require('./lib/hook-caller-context.cjs');
      if (isSubagentEvent(data)) {
        timer.end({ status: 'subagent_event', exit: 0 });
        process.exit(0);
      }

      const { resolveProjectRoot } = require('./lib/resolve-project-root.cjs');
      const inbox = require('./lib/conductor-inbox.cjs');
      const root = resolveProjectRoot();

      // Housekeeping on the prompt boundary only — not on every tool call.
      if (event === 'UserPromptSubmit') inbox.reapStaleInboxes(root, { currentSessionId: sessionId });

      const records = inbox.takeInbox(root, sessionId);
      if (records.length === 0) {
        timer.end({ status: 'empty', exit: 0 });
        process.exit(0);
      }

      // Each message is budgeted on its own (lib/injection-budget.cjs): one long rejection must
      // not truncate an agent_stuck behind it. What the budget refuses goes back in the inbox
      // for the next event, a bounded number of times.
      let injectionBudget = null;
      try { injectionBudget = require('./lib/injection-budget.cjs'); } catch { /* optional */ }

      const delivered = [];
      const refused = [];
      for (const rec of records) {
        const text = injectionBudget
          ? injectionBudget.prepareInjection(`conductor-inbox:${rec.source || 'unknown'}`, rec.text, { sessionId })
          : rec.text;
        if (text) delivered.push(text.trimEnd());
        else refused.push(rec);
      }
      const requeued = inbox.requeue(root, sessionId, refused);

      if (delivered.length > 0) {
        const body = delivered.join('\n');
        if (event === 'UserPromptSubmit') {
          process.stdout.write(body + '\n');
        } else {
          process.stdout.write(JSON.stringify({
            hookSpecificOutput: { hookEventName: event, additionalContext: body }
          }) + '\n');
        }
      }

      timer.end({ status: 'delivered', delivered: delivered.length, requeued, event, exit: 0 });
      process.exit(0);
    } catch (err) {
      if (err && err.bkDispatchExit) throw err;
      timer.end({ status: 'error', error: err.message, exit: 0 });
      process.exit(0);
    }
  }
  main();
} catch (e) {
  if (e && e.bkDispatchExit) throw e;
  try {
    const fs = require('fs');
    const p = require('path');
    const logDir = p.join(__dirname, '.logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(p.join(logDir, 'hook-log.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), hook: 'conductor-inbox-drain', status: 'crash', error: e.message }) + '\n');
  } catch (_) {}
  process.exit(0);
}
