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
   * Monitors: serena, xcode-mcp, xcode-build, figma MCP tools
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
    'figma': {
      fallback: 'AskUserQuestion for manual JSON export',
      message: '[MCP-FALLBACK] Figma MCP unavailable. Use AskUserQuestion to ask user to export design JSON manually.',
    },
  };

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
      const mcpServer = data.mcp_server || '';

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

          process.stdout.write(JSON.stringify({
            additionalContext: message
          }) + '\n');

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
