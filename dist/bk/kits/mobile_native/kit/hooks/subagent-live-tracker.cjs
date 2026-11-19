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
const {
  readStopIdentity, isCompletion, alreadyRecorded, readJsonlRows
} = require('./lib/subagent-stop-identity.cjs');

/**
 * Find the most recent spawn in this session that no later stop has claimed.
 *
 * Enrichment, not identity. The completion has already been identified by `agent_type`; this
 * links it back to the dispatch that started it, for the description and for a duration when
 * the transcript has none. `agentName` is required — matching whatever spawn happens to be
 * unclaimed is how a stray event acquired a name it had no right to. Reading the file is
 * enough: it is append-only and a session rarely has more than a handful of subagents in
 * flight.
 *
 * @param {string} liveFile — path to subagent-live.jsonl
 * @param {string|null} sessionId
 * @param {string} agentName — only a spawn of this agent may be claimed
 * @returns {object|null} the unmatched spawn entry, if any
 */
function findUnmatchedSpawn(liveFile, sessionId, agentName) {
  if (!agentName) return null;
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
    if (entry.event === 'spawn' && entry.name === agentName) spawns.push(entry);
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
      // Keep recording the payload's shape — keys and leaf types, never values. It is what
      // settled the identity question (agent_id / agent_type / agent_transcript_path are all
      // there), and it is how the next CLI change gets noticed rather than guessed at.
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
      const identity = readStopIdentity(hookData);

      // Most SubagentStop events are not a subagent finishing, and a completion can be
      // reported twice. Both rules live in lib/subagent-stop-identity.cjs so that this hook,
      // workflow-metrics and subagent-cost-capture cannot drift apart again — they once
      // reported 7, 8 and 54 completions for the same run of work.
      if (!isCompletion(identity)) {
        timer.end({ status: 'unattributable_stop', exit: 0 });
        process.exit(0);
      }

      if (alreadyRecorded(readJsonlRows(liveFile).filter((r) => r.event === 'stop'),
        'stable_id', identity.id, sessionId)) {
        timer.end({ status: 'duplicate_stop', exit: 0 });
        process.exit(0);
      }

      // `agent_transcript_path` is this subagent's own transcript, which is the file the
      // usage figures were supposed to come from all along. `transcript_path` is the
      // session's, and parsing that yields session-wide totals — recording those as one
      // subagent's usage is what made all 25 stop records in a live run carry identical
      // figures. Prefer the agent transcript; fall back to the session one only when it is
      // demonstrably not the session's own, and otherwise report unattributed.
      const agentTranscript = identity.transcript;
      const sessionTranscript = isOwnSessionTranscript(hookData.transcript_path, sessionId)
        ? null
        : hookData.transcript_path;
      const transcript = agentTranscript || sessionTranscript;
      const parsed = transcript
        ? await parseTranscriptAccurate(transcript, { timeoutMs: 800 })
        : null;

      // Enrichment, not identity: link this completion back to its dispatch so the record
      // carries the spawn's description and can supply a duration when the transcript has no
      // usable timestamps. Matched by name — an unclaimed spawn of a DIFFERENT agent is
      // somebody else's dispatch, and claiming it is how phantom completions appeared.
      const spawn = findUnmatchedSpawn(liveFile, sessionId, identity.name);

      const entry = {
        ts: new Date().toISOString(),
        event: 'stop',
        session_id: hookData.session_id || null,
        stable_id: identity.id,
        agent_id: identity.eventId,
        subagent_id: (spawn && spawn.subagent_id) || null,
        name: identity.name,
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
