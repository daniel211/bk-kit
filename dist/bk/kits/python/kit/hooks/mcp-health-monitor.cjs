#!/usr/bin/env node
// mcp-health-monitor.cjs - Monitor MCP tool calls and inject fallback guidance
// Trigger: PreToolUse (MCP-related tools)

'use strict';

// Outer crash wrapper (catches require/parse failures)
try {
  const { createHookTimer } = require('./lib/hook-logger.cjs');

  /**
   * MCP Health Monitor Hook
   * Trigger: PreToolCall
   * Purpose: Detect MCP availability issues and inject fallback guidance
   *
   * Monitors: serena, xcode-mcp, xcode-build, figma MCP tools (figma is legacy — see below)
   * On timeout/error: inject fallback instructions via stdout
   */

  const MCP_FALLBACK = {
    'serena': {
      fallback: 'Grep/Glob per coding-intelligence-priority.md',
      message: '[MCP-FALLBACK] Serena slow/unavailable. Switching to text-based search (Grep/Glob). This is automatic — no action needed.',
    },
    'xcode-mcp': {
      fallback: 'xcodebuild CLI via Bash',
      message: '[MCP-FALLBACK] Xcode MCP unavailable. Use xcodebuild CLI directly via Bash.',
    },
    'xcode-build': {
      fallback: 'xcodebuild CLI via Bash',
      message: '[MCP-FALLBACK] xcode-build MCP unavailable. Use Bash(xcodebuild ...) directly.',
    },
    // Kept for projects whose config still registers a Figma MCP. Since v0.3.0 the design
    // pipeline does not use one — it reads the REST API — so the fallback is the CLI, not a
    // request for the user to export JSON by hand.
    'figma': {
      fallback: 'scripts/figma-cli.mjs (Figma REST API)',
      message: '[MCP-FALLBACK] Figma MCP unavailable, and not needed. Use '
        + '"node .claude/scripts/figma-cli.mjs <command>", which reads Figma over its REST '
        + 'API with FIGMA_API_KEY. See skills/bk-design/references/figma-data-guide.md.',
    },
  };

  /**
   * `mcp_server` is not always a string — the field logged `mcpServer.includes is not a
   * function` when it arrived as an object like {name}. Accept a string, or an object with a
   * string name/server/id; anything else (undefined, number, null) is "no server".
   */
  function normalizeMcpServer(v) {
    if (typeof v === 'string') return v;
    if (v && typeof v === 'object') {
      for (const k of ['name', 'server', 'id']) if (typeof v[k] === 'string') return v[k];
    }
    return '';
  }

  async function main() {
    const timer = createHookTimer('mcp-health-monitor');
    try {
      const { isHookEnabled } = require('./lib/bk-config-utils.cjs');

      if (!isHookEnabled('mcp-health-monitor')) {
        timer.end({ status: 'skipped', exit: 0 });
        process.exit(0);
      }

      let input = '';
      for await (const chunk of process.stdin) input += chunk;
      const data = JSON.parse(input || '{}');

      const { getToolName } = require('./lib/hook-event-accessor.cjs');
      const toolName = (getToolName(data) || '').toLowerCase();
      const mcpServer = normalizeMcpServer(data.mcp_server);

      // Check if this is an MCP tool call
      const mcpKey = Object.keys(MCP_FALLBACK).find(k =>
        toolName.includes(k) || mcpServer.includes(k)
      );

      if (mcpKey) {
        // Check MCP availability from environment
        const envKey = `BK_MCP_${mcpKey.toUpperCase().replace(/-/g, '_')}_AVAILABLE`;
        const mcpAvailable = process.env[envKey];

        if (mcpAvailable === 'false' || mcpAvailable === '0') {
          const { message } = MCP_FALLBACK[mcpKey];

          // Advisory context is subject to the shared injection budget (cap + dedupe).
          // Optional lib: if absent the message goes out unchanged.
          let text = message;
          try {
            const injectionBudget = require('./lib/injection-budget.cjs');
            text = injectionBudget.prepareInjection('mcp-health-monitor', message, {
              sessionId: injectionBudget.sessionIdFrom(data)
            });
          } catch { /* optional lib — keep the full text */ }

          if (text) process.stdout.write(JSON.stringify({ additionalContext: text }) + '\n');

          timer.end({ status: 'fallback_injected', mcpKey, exit: 0 });
          process.exit(0);
        }
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
  // A DispatchExit is this hook's own process.exit() unwinding under bk-dispatch, not a
  // crash. Logging it here is how a clean run got filed as `status: "crash"`.
  if (e && e.bkDispatchExit) throw e;

  try {
    const fs = require('fs');
    const p = require('path');
    const logDir = p.join(__dirname, '.logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    try { const {appendJsonl: _ra} = require('./lib/jsonl-rotator.cjs'); _ra(p.join(logDir, 'hook-log.jsonl'), JSON.stringify({ ts: new Date().toISOString(), hook: 'mcp-health-monitor', status: 'crash', error: e.message }) + '\n'); }
    catch(_e2) { fs.appendFileSync(p.join(logDir, 'hook-log.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), hook: 'mcp-health-monitor', status: 'crash', error: e.message }) + '\n'); }
  } catch (_) {}
  process.exit(0);
}
