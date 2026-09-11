'use strict';
/**
 * timeline.cjs — Flatten and render timeline of events from JSONL sources.
 */

const fs = require('fs');
const path = require('path');
const { resolveCliProjectRoot } = require('./project-root.cjs');

const isTTY = process.stdout.isTTY;
const YELLOW = isTTY ? '\x1b[33m' : '';
const RED    = isTTY ? '\x1b[31m' : '';
const GREEN  = isTTY ? '\x1b[32m' : '';
const DIM    = isTTY ? '\x1b[2m'  : '';
const RESET  = isTTY ? '\x1b[0m'  : '';

function readJsonlFiltered(filePath, windowMs) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  try {
    const cutoff = windowMs ? Date.now() - windowMs : 0;
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw.split('\n').filter(Boolean).map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(e => e && (windowMs ? e.ts >= cutoff : true));
  } catch { return []; }
}

/**
 * Collect and sort all events from multiple JSONL sources.
 * @param {{ projectRoot: string, windowMs?: number }} opts
 * @returns {Array<{ts, kind, summary, data}>}
 */
function getTimelineEvents(opts = {}) {
  const root = resolveCliProjectRoot(opts.projectRoot);
  const windowMs = opts.windowMs || (24 * 60 * 60 * 1000);
  const metricsDir = path.join(root, '.bk-metrics');

  const events = [];

  // Violations
  const violations = readJsonlFiltered(path.join(metricsDir, 'violations.jsonl'), windowMs);
  for (const v of violations) {
    events.push({
      ts: v.ts,
      kind: 'violation',
      summary: `[${v.hook || '?'}] ${v.violation_type || 'violation'} on ${v.target || v.tool || '?'}`,
      data: v
    });
  }

  // Decisions
  const decisions = readJsonlFiltered(path.join(metricsDir, 'decisions.jsonl'), windowMs);
  for (const d of decisions) {
    events.push({
      ts: d.ts,
      kind: 'decision',
      summary: `[${d.agent || '?'}] Decision: ${(d.decision || '').slice(0, 60)}`,
      data: d
    });
  }

  // Red signals
  const redSignals = readJsonlFiltered(path.join(metricsDir, 'red-signals.jsonl'), windowMs);
  for (const r of redSignals) {
    events.push({
      ts: r.ts,
      kind: 'red_signal',
      summary: `RED SIGNAL: ${r.type || 'unknown'}`,
      data: r
    });
  }

  // Sort by timestamp
  events.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  return events;
}

/**
 * Render timeline as terminal string.
 * @param {Array} events - from getTimelineEvents()
 * @returns {string}
 */
function renderTimeline(events) {
  if (events.length === 0) {
    return 'No events in the selected window.';
  }

  const lines = ['HARNESS EVENT TIMELINE', '═'.repeat(70)];

  for (const ev of events) {
    const ts = ev.ts ? new Date(ev.ts).toISOString().replace('T', ' ').slice(0, 19) : '?';
    let kindColor;
    switch (ev.kind) {
      case 'violation':  kindColor = `${RED}VIOLATION ${RESET}`; break;
      case 'decision':   kindColor = `${GREEN}DECISION  ${RESET}`; break;
      case 'red_signal': kindColor = `${YELLOW}RED-SIG   ${RESET}`; break;
      default:           kindColor = `${DIM}EVENT     ${RESET}`;
    }
    lines.push(`${DIM}${ts}${RESET}  ${kindColor}${ev.summary}`);
  }

  lines.push('═'.repeat(70));
  lines.push(`Total: ${events.length} events`);
  return lines.join('\n');
}

module.exports = { getTimelineEvents, renderTimeline };
