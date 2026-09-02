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
const { isAgentDispatch, getToolInput } = require('./lib/hook-event-accessor.cjs');

/**
 * Find the most recent spawn in this session that no later stop has claimed.
 *
 * SubagentStop carries no agent name or id, so identity has to come from the spawn
 * recorded when the dispatch started. Reading the file is enough: it is append-only
 * and a session rarely has more than a handful of subagents in flight.
 *
 * @param {string} liveFile — path to subagent-live.jsonl
 * @param {string|null} sessionId
 * @returns {object|null} the unmatched spawn entry, if any
 */
function findUnmatchedSpawn(liveFile, sessionId) {
  let rows;
  try {
    rows = fs.readFileSync(liveFile, 'utf8').trim().split('\n');
  } catch {
    return null; // no history yet
  }
  const claimed = new Set();
  const spawns = [];
  for (const line of rows) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (sessionId && entry.session_id && entry.session_id !== sessionId) continue;
    if (entry.event === 'spawn') spawns.push(entry);
    else if (entry.event === 'stop' && entry.subagent_id) claimed.add(entry.subagent_id);
  }
  for (let i = spawns.length - 1; i >= 0; i--) {
    if (!claimed.has(spawns[i].subagent_id)) return spawns[i];
  }
  return null;
}

/**
 * Wall-clock duration from a spawn record to now — the one timing figure that is
 * genuinely this subagent's even when token usage cannot be attributed.
 */
function spawnDurationMs(spawn) {
  if (!spawn || !spawn.ts) return null;
  const started = Date.parse(spawn.ts);
  return Number.isNaN(started) ? null : Date.now() - started;
}

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

    if (eventName === 'PreToolUse' && isAgentDispatch(hookData)) {
      // ── Spawn event ──────────────────────────────────────────────────────────
      const sid = `sg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const entry = {
        ts: new Date().toISOString(),
        event: 'spawn',
        session_id: hookData.session_id || null,
        subagent_id: sid,
        name: getToolInput(hookData).subagent_type || 'general',
        description: (getToolInput(hookData).description || '').slice(0, 80),
        parent_tool_use_id: hookData.tool_use_id || null
      };
      appendJsonl(liveFile, JSON.stringify(entry) + '\n');

    } else if (eventName === 'SubagentStop') {
      // SubagentStop fires far more often than subagents are dispatched: one live run
      // recorded 5 spawns against 45 stops, spread evenly rather than bursting, so they
      // are not duplicates of one completion. Whether the event marks a subagent finishing
      // or something finer-grained cannot be told from the fields the kit currently reads.
      // Record the payload's shape — keys and leaf types, never values — so the next run
      // settles it instead of another guess.
      try {
        const shapeOf = (v, d) => {
          if (v === null) return 'null';
          if (Array.isArray(v)) return `array[${v.length}]`;
          if (typeof v !== 'object') return typeof v;
          if (d === 0) return 'object';
          return Object.fromEntries(Object.keys(v).sort().map(k => [k, shapeOf(v[k], d - 1)]));
        };
        fs.writeFileSync(
          path.join(root, '.bk-metrics', 'subagent-stop-payload-keys.json'),
          JSON.stringify({ observedAt: new Date().toISOString(), shape: shapeOf(hookData, 3) }, null, 2) + '\n',
        );
      } catch { /* diagnostics are best-effort */ }

      // ── Stop event ───────────────────────────────────────────────────────────
      const { parseTranscriptAccurate, isOwnSessionTranscript } = require('./lib/token-accurate-parser.cjs');
      const sessionId = hookData.session_id || null;

      // SubagentStop hands over the *session* transcript — Claude Code keeps one
      // transcript per session and subagent turns never appear in it. Parsing it here
      // yields session-wide totals; recording those as this subagent's usage is what
      // made all 25 stop records in a live run carry identical figures. Report the
      // usage as unattributed rather than confidently wrong.
      const unattributed = isOwnSessionTranscript(hookData.transcript_path, sessionId);
      const parsed = hookData.transcript_path && !unattributed
        ? await parseTranscriptAccurate(hookData.transcript_path, { timeoutMs: 800 })
        : null;

      // Identity comes from the matching spawn — SubagentStop carries no agent name.
      const spawn = findUnmatchedSpawn(liveFile, sessionId);

      const entry = {
        ts: new Date().toISOString(),
        event: 'stop',
        session_id: hookData.session_id || null,
        subagent_id: (spawn && spawn.subagent_id) || null,
        name: (spawn && spawn.name) || hookData.agent_name || hookData.subagent_name || 'unknown',
        duration_ms: parsed ? parsed.durationMs : spawnDurationMs(spawn),
        tokens_in: parsed ? parsed.tokensIn : null,
        tokens_out: parsed ? parsed.tokensOut : null,
        cost_usd: parsed ? parsed.costUsd : null,
        status: hookData.stop_reason || 'success',
        accuracy: parsed ? parsed.accuracy : 'unattributed'
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
