'use strict';
/**
 * subagent-parallel-metric.cjs — Compute parallel efficiency from subagent lifecycle events.
 *
 * Uses a sweep-line algorithm to count concurrency, overlap, and parallel efficiency.
 *
 * API:
 *   computeParallelMetric(events) → {
 *     totalSubagents,
 *     serialDurationMs,      // sum of (stop - spawn) per subagent pair
 *     wallClockDurationMs,   // max(stop) - min(spawn)
 *     overlapDurationMs,     // total time with ≥2 subagents active
 *     parallelEfficiency,    // 1 - (wallClock / serialDuration), or 0
 *     concurrencyPeak        // max simultaneous subagents active
 *   }
 */

/**
 * Match spawn/stop events into paired intervals.
 *
 * Matching strategy:
 *   1. If subagent_id present on both spawn+stop, match by subagent_id.
 *   2. Fallback: match by name, FIFO order within same name group.
 *
 * @param {Array<{event: string, subagent_id?: string, name?: string, ts: string}>} events
 * @returns {Array<{id: string, name: string, spawnTs: number, stopTs: number|null}>}
 */
function matchEvents(events) {
  const sorted = [...events].sort((a, b) => {
    const ta = new Date(a.ts).getTime();
    const tb = new Date(b.ts).getTime();
    return ta - tb;
  });

  // Map: subagent_id → spawn event (for id-based matching)
  const idSpawnMap = new Map();
  // Map: name → queue of spawn events waiting for a stop (for FIFO name matching)
  const nameSpawnQueue = new Map();
  // Completed intervals
  const intervals = [];
  // Unmatched spawns (will have null stopTs)
  const pendingSpawns = [];

  for (const ev of sorted) {
    const ts = new Date(ev.ts).getTime();
    if (isNaN(ts)) continue;

    if (ev.event === 'spawn') {
      const id = ev.subagent_id || null;
      const name = ev.name || 'unknown';
      const entry = { id, name, spawnTs: ts, stopTs: null };

      if (id) {
        idSpawnMap.set(id, entry);
      }
      // Always add to name queue for FIFO fallback
      if (!nameSpawnQueue.has(name)) nameSpawnQueue.set(name, []);
      nameSpawnQueue.get(name).push(entry);
      pendingSpawns.push(entry);

    } else if (ev.event === 'stop') {
      const id = ev.subagent_id || null;
      const name = ev.name || 'unknown';
      let matched = null;

      // Try id match first
      if (id && idSpawnMap.has(id)) {
        matched = idSpawnMap.get(id);
        idSpawnMap.delete(id);
        // Remove from name queue
        const q = nameSpawnQueue.get(matched.name);
        if (q) {
          const idx = q.indexOf(matched);
          if (idx !== -1) q.splice(idx, 1);
        }
        const pi = pendingSpawns.indexOf(matched);
        if (pi !== -1) pendingSpawns.splice(pi, 1);
      } else {
        // FIFO by name
        const q = nameSpawnQueue.get(name);
        if (q && q.length > 0) {
          matched = q.shift();
          // Remove from idSpawnMap if it had an id
          if (matched.id) idSpawnMap.delete(matched.id);
          const pi = pendingSpawns.indexOf(matched);
          if (pi !== -1) pendingSpawns.splice(pi, 1);
        }
      }

      if (matched) {
        matched.stopTs = ts;
        intervals.push(matched);
      }
      // If no spawn found for this stop, ignore
    }
  }

  // Any unmatched spawns: add with null stopTs
  for (const entry of pendingSpawns) {
    intervals.push(entry);
  }

  return intervals;
}

/**
 * Compute parallel metrics from raw spawn/stop events.
 *
 * @param {Array<{event: string, subagent_id?: string, name?: string, ts: string}>} events
 * @returns {{
 *   totalSubagents: number,
 *   serialDurationMs: number,
 *   wallClockDurationMs: number,
 *   overlapDurationMs: number,
 *   parallelEfficiency: number,
 *   concurrencyPeak: number
 * }}
 */
function computeParallelMetric(events) {
  const defaults = {
    totalSubagents: 0,
    serialDurationMs: 0,
    wallClockDurationMs: 0,
    overlapDurationMs: 0,
    parallelEfficiency: 0,
    concurrencyPeak: 0
  };

  if (!Array.isArray(events) || events.length === 0) return defaults;

  const intervals = matchEvents(events);

  // Only consider fully-matched intervals (have both spawn and stop)
  const complete = intervals.filter(i => i.spawnTs != null && i.stopTs != null && i.stopTs >= i.spawnTs);

  if (complete.length === 0) return defaults;

  const totalSubagents = complete.length;

  // Serial duration: sum of individual durations
  let serialDurationMs = 0;
  for (const iv of complete) {
    serialDurationMs += iv.stopTs - iv.spawnTs;
  }

  // Wall-clock: from earliest spawn to latest stop
  const minSpawn = Math.min(...complete.map(i => i.spawnTs));
  const maxStop = Math.max(...complete.map(i => i.stopTs));
  const wallClockDurationMs = maxStop - minSpawn;

  // Sweep-line to compute overlap (time with ≥2 active) and concurrencyPeak
  // Build events list: +1 at spawn, -1 at stop
  const sweepEvents = [];
  for (const iv of complete) {
    sweepEvents.push({ ts: iv.spawnTs, delta: +1 });
    sweepEvents.push({ ts: iv.stopTs, delta: -1 });
  }
  sweepEvents.sort((a, b) => a.ts - b.ts || a.delta - b.delta); // stops before spawns at same ts? Actually spawns before stops

  let overlapDurationMs = 0;
  let concurrencyPeak = 0;
  let active = 0;
  let prevTs = null;

  for (const ev of sweepEvents) {
    if (prevTs !== null && active >= 2) {
      overlapDurationMs += ev.ts - prevTs;
    }
    if (prevTs !== null && active >= 1) {
      // track wall
    }
    active += ev.delta;
    if (active > concurrencyPeak) concurrencyPeak = active;
    prevTs = ev.ts;
  }

  // parallelEfficiency: 1 - (wallClock / serialDuration)
  let parallelEfficiency = 0;
  if (serialDurationMs > 0) {
    parallelEfficiency = Math.max(0, 1 - wallClockDurationMs / serialDurationMs);
    // Round to reasonable precision
    parallelEfficiency = Math.round(parallelEfficiency * 1e6) / 1e6;
  }

  return {
    totalSubagents,
    serialDurationMs,
    wallClockDurationMs,
    overlapDurationMs,
    parallelEfficiency,
    concurrencyPeak
  };
}

module.exports = { computeParallelMetric, matchEvents };
