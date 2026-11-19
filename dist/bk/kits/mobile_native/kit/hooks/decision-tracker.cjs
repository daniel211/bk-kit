#!/usr/bin/env node
// decision-tracker.cjs — SubagentStop hook: parse <!-- bk-decision --> blocks and log to decisions.jsonl
// Trigger: SubagentStop (matcher: *)
// Non-blocking (exit 0 always).

'use strict';

try {
  const fs = require('fs');
  const { createHookTimer } = require('./lib/hook-logger.cjs');
  const { isHookEnabled, readWorkflowState } = require('./lib/bk-config-utils.cjs');
  const { trackDecision } = require('./lib/harness-policy-loader.cjs');
  const { extractDecisionBlocks } = require('./lib/decision-parser.cjs');

  async function main() {
    const timer = createHookTimer('decision-tracker');
    try {
      if (!isHookEnabled('decision-tracker')) {
        timer.end({ status: 'skipped', exit: 0 });
        process.exit(0);
      }

      // Read stdin JSON from Claude Code
      let raw = '';
      for await (const chunk of process.stdin) raw += chunk;
      const data = JSON.parse(raw || '{}');

      const agentType = data.agent_type || data.agent_name || 'unknown';

      // Get agent output text
      let agentText = '';
      if (data.agent_result && typeof data.agent_result === 'string') {
        agentText = data.agent_result;
      } else if (data.transcript_path && typeof data.transcript_path === 'string') {
        try {
          if (fs.existsSync(data.transcript_path)) {
            agentText = fs.readFileSync(data.transcript_path, 'utf8');
          }
        } catch { /* fail-open */ }
      }

      if (!agentText) {
        timer.end({ status: 'no_content', exit: 0 });
        process.exit(0);
      }

      // Parse decision blocks
      const blocks = extractDecisionBlocks(agentText);
      if (blocks.length === 0) {
        timer.end({ status: 'no_decisions', exit: 0 });
        process.exit(0);
      }

      // Read workflow state for context
      const state = readWorkflowState() || {};
      const workflow = state.feature || state.command || 'unknown';

      // Track each decision asynchronously (non-blocking)
      let logged = 0;
      for (const block of blocks) {
        try {
          trackDecision({
            workflow,
            agent: agentType,
            decision: block.decision,
            reason: block.reason,
            alternatives: block.alternatives,
            scope: block.scope
          });
          logged++;
        } catch { /* fail-open per block */ }
      }

      timer.end({ status: 'ok', agent: agentType, decisions_logged: logged, exit: 0 });
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
    try { const {appendJsonl: _ra} = require('./lib/jsonl-rotator.cjs'); _ra(p.join(logDir, 'hook-log.jsonl'), JSON.stringify({ ts: new Date().toISOString(), hook: 'decision-tracker', status: 'crash', error: e.message }) + '\n'); }
    catch(_e2) { fs.appendFileSync(p.join(logDir, 'hook-log.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), hook: 'decision-tracker', status: 'crash', error: e.message }) + '\n'); }
  } catch (_) {}
  process.exit(0); // Fail-open
}
