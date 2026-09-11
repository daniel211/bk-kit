'use strict';
/**
 * subagent-drill-down.cjs — Subagent session drill-down for bk-health CLI.
 *
 * Usage:
 *   const { drillDown } = require('./subagent-drill-down.cjs');
 *   const output = await drillDown({ sessionId, format, sinceHours, projectRoot });
 *
 * Reads .bk-metrics/subagent-live.jsonl, filters by session + time,
 * computes parallel metrics via computeParallelMetric, and renders
 * human-readable or JSON output.
 */

const fs = require('fs');
const path = require('path');
const { computeParallelMetric } = require('./subagent-parallel-metric.cjs');
const { resolveCliProjectRoot } = require('./project-root.cjs');

/**
 * Read and parse JSONL file, return array of parsed entries (skip malformed lines).
 * @param {string} filePath
 * @returns {object[]}
 */
function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw.split('\n').filter(Boolean).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Match spawn + stop events into per-subagent breakdown entries.
 * Uses subagent_id if available, otherwise FIFO by name.
 *
 * @param {object[]} events - filtered events for this session
 * @returns {Array<{name, spawnTs, stopTs, durationMs, tokensIn, tokensOut, costUsd, status, accuracy}>}
 */
function buildBreakdown(events) {
  const sorted = [...events].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

  // Map: subagent_id → spawn record
  const idMap = new Map();
  // Map: name → queue of spawn records (for FIFO)
  const nameQueue = new Map();
  const breakdown = [];
  const pendingSpawns = [];

  for (const ev of sorted) {
    if (ev.event === 'spawn') {
      const entry = {
        name: ev.name || 'unknown',
        subagent_id: ev.subagent_id || null,
        spawnTs: new Date(ev.ts).getTime(),
        stopTs: null,
        durationMs: null,
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        status: null,
        accuracy: 'low'
      };
      if (entry.subagent_id) idMap.set(entry.subagent_id, entry);
      if (!nameQueue.has(entry.name)) nameQueue.set(entry.name, []);
      nameQueue.get(entry.name).push(entry);
      pendingSpawns.push(entry);

    } else if (ev.event === 'stop') {
      const id = ev.subagent_id || null;
      const name = ev.name || 'unknown';
      let matched = null;

      if (id && idMap.has(id)) {
        matched = idMap.get(id);
        idMap.delete(id);
        const q = nameQueue.get(matched.name);
        if (q) { const i = q.indexOf(matched); if (i !== -1) q.splice(i, 1); }
        const pi = pendingSpawns.indexOf(matched);
        if (pi !== -1) pendingSpawns.splice(pi, 1);
      } else {
        const q = nameQueue.get(name);
        if (q && q.length > 0) {
          matched = q.shift();
          if (matched.subagent_id) idMap.delete(matched.subagent_id);
          const pi = pendingSpawns.indexOf(matched);
          if (pi !== -1) pendingSpawns.splice(pi, 1);
        }
      }

      if (matched) {
        matched.stopTs = new Date(ev.ts).getTime();
        matched.durationMs = ev.duration_ms != null ? ev.duration_ms : (matched.stopTs - matched.spawnTs);
        matched.tokensIn = ev.tokens_in || 0;
        matched.tokensOut = ev.tokens_out || 0;
        matched.costUsd = ev.cost_usd || 0;
        matched.status = ev.status || 'success';
        matched.accuracy = ev.accuracy || 'low';
        breakdown.push(matched);
      }
    }
  }

  // Add unmatched spawns (no stop received)
  for (const entry of pendingSpawns) {
    breakdown.push(entry);
  }

  return breakdown;
}

/**
 * Format milliseconds as human-readable string (e.g., "2m 48s", "42s", "1h 2m").
 */
function formatDuration(ms) {
  if (ms == null || ms < 0) return '0s';
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const parts = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0 || parts.length === 0) parts.push(`${s}s`);
  return parts.join(' ');
}

/**
 * Format token count with commas (e.g., 12340 → "12,340").
 */
function formatTokens(n) {
  if (!n) return '0';
  return n.toLocaleString('en-US');
}

/**
 * Render text output for drill-down.
 */
function renderText(sessionId, breakdown, metric) {
  const lines = [];

  lines.push(`Session: ${sessionId || '(all)'}`);
  const effPct = Math.round((metric.parallelEfficiency || 0) * 100);
  lines.push(`Wall-clock: ${formatDuration(metric.wallClockDurationMs)}  ·  Parallel efficiency: ${effPct}%  ·  Concurrency peak: ${metric.concurrencyPeak}`);
  lines.push('');
  lines.push('Subagent breakdown:');

  breakdown.forEach((entry, idx) => {
    const dur = formatDuration(entry.durationMs || (entry.stopTs ? entry.stopTs - entry.spawnTs : 0));
    const tokens = formatTokens((entry.tokensIn || 0) + (entry.tokensOut || 0));
    const cost = (entry.costUsd || 0).toFixed(2);
    const statusIcon = entry.status === 'success' ? '✓' : '✗';
    const statusStr = entry.status || 'running';
    const nameField = entry.name.padEnd(28);
    lines.push(`  ${idx + 1}. ${nameField} ${dur.padStart(5)}   ${tokens.padStart(10)} tokens   $${cost}   ${statusIcon} ${statusStr}`);
  });

  lines.push('');
  const totalTokens = breakdown.reduce((sum, e) => sum + (e.tokensIn || 0) + (e.tokensOut || 0), 0);
  const totalCost = breakdown.reduce((sum, e) => sum + (e.costUsd || 0), 0);
  const serialStr = formatDuration(metric.serialDurationMs);
  const wallStr = formatDuration(metric.wallClockDurationMs);
  lines.push(`Total: ${metric.totalSubagents} subagents  ·  ${serialStr} serial  ·  ${wallStr} wall-clock  ·  $${totalCost.toFixed(2)}`);

  return lines.join('\n');
}

/**
 * Main drill-down function.
 *
 * @param {object} opts
 * @param {string} [opts.sessionId]  - Session to filter (default: latest session)
 * @param {string} [opts.format]     - 'text' | 'json' (default: 'text')
 * @param {number} [opts.sinceHours] - Filter events from last N hours
 * @param {string} [opts.projectRoot] - Project root (default: cwd)
 * @returns {Promise<string>}
 */
async function drillDown({ sessionId, format = 'text', sinceHours, projectRoot } = {}) {
  const root = resolveCliProjectRoot(projectRoot);
  const liveFile = path.join(root, '.bk-metrics', 'subagent-live.jsonl');

  let allEvents = readJsonl(liveFile);

  // Time filter
  if (sinceHours) {
    const cutoff = Date.now() - sinceHours * 60 * 60 * 1000;
    allEvents = allEvents.filter(ev => {
      const t = new Date(ev.ts).getTime();
      return !isNaN(t) && t >= cutoff;
    });
  }

  // Find target session
  let targetSession = sessionId;
  if (!targetSession) {
    // Use latest session: find most recent event's session_id
    const withSession = allEvents.filter(ev => ev.session_id);
    if (withSession.length > 0) {
      const latest = withSession.reduce((a, b) =>
        new Date(a.ts).getTime() > new Date(b.ts).getTime() ? a : b
      );
      targetSession = latest.session_id;
    }
  }

  if (!targetSession) {
    if (format === 'json') {
      return JSON.stringify({ sessionId: null, message: 'No subagent data found.', totalSubagents: 0 }, null, 2);
    }
    return 'No subagent data found. (No sessions in .bk-metrics/subagent-live.jsonl)';
  }

  // Filter to session
  const sessionEvents = allEvents.filter(ev => ev.session_id === targetSession);

  if (sessionEvents.length === 0) {
    if (format === 'json') {
      return JSON.stringify({ sessionId: targetSession, message: 'No events for this session.', totalSubagents: 0 }, null, 2);
    }
    return `No events found for session: ${targetSession}`;
  }

  // Build breakdown
  const breakdown = buildBreakdown(sessionEvents);

  // Compute parallel metrics (using spawn/stop events for algorithm)
  const metric = computeParallelMetric(sessionEvents);

  if (format === 'json') {
    const result = {
      sessionId: targetSession,
      wallClockDurationMs: metric.wallClockDurationMs,
      wallClockFormatted: formatDuration(metric.wallClockDurationMs),
      parallelEfficiency: metric.parallelEfficiency,
      parallelEfficiencyPct: Math.round(metric.parallelEfficiency * 100),
      concurrencyPeak: metric.concurrencyPeak,
      totalSubagents: metric.totalSubagents,
      serialDurationMs: metric.serialDurationMs,
      overlapDurationMs: metric.overlapDurationMs,
      subagents: breakdown.map((entry, idx) => ({
        index: idx + 1,
        name: entry.name,
        durationMs: entry.durationMs,
        durationFormatted: formatDuration(entry.durationMs || 0),
        tokensIn: entry.tokensIn || 0,
        tokensOut: entry.tokensOut || 0,
        totalTokens: (entry.tokensIn || 0) + (entry.tokensOut || 0),
        costUsd: entry.costUsd || 0,
        status: entry.status || 'unknown',
        accuracy: entry.accuracy || 'low'
      })),
      totalCostUsd: breakdown.reduce((s, e) => s + (e.costUsd || 0), 0),
      totalTokens: breakdown.reduce((s, e) => s + (e.tokensIn || 0) + (e.tokensOut || 0), 0)
    };
    return JSON.stringify(result, null, 2);
  }

  return renderText(targetSession, breakdown, metric);
}

module.exports = { drillDown, buildBreakdown, readJsonl, formatDuration };
