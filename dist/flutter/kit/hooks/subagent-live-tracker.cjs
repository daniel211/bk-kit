#!/usr/bin/env node
/**
 * subagent-live-tracker.cjs — Track subagent lifecycle (spawn → stop) in real time
 *
 * Triggers:
 *   PreToolUse  (tool_name=Task) → emit 'spawn' event
 *   SubagentStop                 → emit 'stop' event with token/cost data
 *
 * Output: append JSONL to .bk-metrics/subagent-live.jsonl
 *
 * Fail-open: catches all errors, logs to stderr, exits 0.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { createHookTimer } = require('./lib/hook-logger.cjs');
const { appendJsonl } = require('./lib/jsonl-rotator.cjs');
const { resolveProjectRoot } = require('./lib/resolve-project-root.cjs');
const { isHookEnabled } = require('./lib/bk-config-utils.cjs');

async function main() {
  const timer = createHookTimer('subagent-live-tracker');
  try {
    if (!isHookEnabled('subagent-live-tracker')) {
      timer.end({ status: 'skipped', exit: 0 });
      process.exit(0);
    }

    // Read hook data from stdin (fd 0)
    let hookData = {};
    try {
      const raw = fs.readFileSync(0, 'utf8');
      if (raw && raw.trim()) hookData = JSON.parse(raw);
    } catch { /* no stdin or malformed — use empty object */ }

    const eventName = hookData.hook_event_name || hookData.hookEventName;
    const root = resolveProjectRoot(hookData);
    const liveFile = path.join(root, '.bk-metrics', 'subagent-live.jsonl');
    fs.mkdirSync(path.dirname(liveFile), { recursive: true });

    if (eventName === 'PreToolUse' && hookData.tool_name === 'Task') {
      // ── Spawn event ──────────────────────────────────────────────────────────
      const sid = `sg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const entry = {
        ts: new Date().toISOString(),
        event: 'spawn',
        session_id: hookData.session_id || null,
        subagent_id: sid,
        name: (hookData.tool_input && hookData.tool_input.subagent_type)
          ? hookData.tool_input.subagent_type
          : 'general',
        description: ((hookData.tool_input && hookData.tool_input.description) || '').slice(0, 80),
        parent_tool_use_id: hookData.tool_use_id || null
      };
      appendJsonl(liveFile, JSON.stringify(entry) + '\n');

    } else if (eventName === 'SubagentStop') {
      // ── Stop event ───────────────────────────────────────────────────────────
      const { parseTranscriptAccurate } = require('./lib/token-accurate-parser.cjs');
      const parsed = hookData.transcript_path
        ? await parseTranscriptAccurate(hookData.transcript_path, { timeoutMs: 800 })
        : null;

      const entry = {
        ts: new Date().toISOString(),
        event: 'stop',
        session_id: hookData.session_id || null,
        subagent_id: null, // matching done by bk-health at read time via name+ts
        name: hookData.agent_name || hookData.subagent_name || 'unknown',
        duration_ms: (parsed && parsed.durationMs) || null,
        tokens_in: (parsed && parsed.tokensIn) || 0,
        tokens_out: (parsed && parsed.tokensOut) || 0,
        cost_usd: (parsed && parsed.costUsd) || 0,
        status: hookData.stop_reason || 'success',
        accuracy: (parsed && parsed.accuracy) || 'low'
      };
      appendJsonl(liveFile, JSON.stringify(entry) + '\n');
    }
    // Unknown event — do nothing (fail-open)

    timer.end({ status: 'ok', exit: 0 });
    process.exit(0);
  } catch (err) {
    process.stderr.write(`[subagent-live-tracker] warn: ${err.message}\n`);
    timer.end({ status: 'error', exit: 0 });
    process.exit(0); // fail-open
  }
}

if (require.main === module) { main(); }
module.exports = { main };
