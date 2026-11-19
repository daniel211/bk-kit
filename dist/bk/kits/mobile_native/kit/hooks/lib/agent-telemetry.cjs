/**
 * agent-telemetry.cjs - Agent lifecycle trace writer
 *
 * Logs agent start/stop events to .logs/agent-trace.jsonl.
 * Reuses hook-logger rotation pattern (1000 lines max, prune to 500).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const TRACE_FILE = path.join(__dirname, '..', '.logs', 'agent-trace.jsonl');
const MAX_LINES = 1000;
const PRUNE_TO = 500;

/**
 * Write an agent lifecycle trace entry
 * @param {string} event - 'start' or 'stop'
 * @param {Object} data - Trace fields (agent, feature, platform, phase, status, etc.)
 */
function traceAgent(event, data) {
  try {
    const dir = path.dirname(TRACE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // Rotate if over limit
    if (fs.existsSync(TRACE_FILE)) {
      const lines = fs.readFileSync(TRACE_FILE, 'utf8').split('\n').filter(Boolean);
      if (lines.length >= MAX_LINES) {
        fs.writeFileSync(TRACE_FILE, lines.slice(-PRUNE_TO).join('\n') + '\n');
      }
    }

    const entry = { ts: new Date().toISOString(), event, ...data };
    fs.appendFileSync(TRACE_FILE, JSON.stringify(entry) + '\n');
  } catch { /* fail silently */ }
}

module.exports = { traceAgent };
