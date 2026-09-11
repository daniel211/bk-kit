'use strict';
/**
 * tokens.cjs — Token & cost panel for bk-health dashboard.
 *
 * Reads .bk-metrics/cost-ledger.jsonl → groups by agentType →
 * returns top 3 by total tokens + overall totals.
 *
 * Exports:
 *   buildTokenPanel(metricsDir) → { agents: [...], totals: { in, out, cost_usd } }
 */

const fs = require('fs');
const path = require('path');

/**
 * Format token count as short form (e.g. 152000 → "152k", 1200000 → "1.2M").
 * @param {number} n
 * @returns {string}
 */
function shortTokens(n) {
  if (typeof n !== 'number' || isNaN(n) || n === 0) return '0';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

/**
 * Read and parse a JSONL file, returning an array of parsed objects.
 * Returns [] on file-not-found or parse errors (fail-open).
 * @param {string} filePath
 * @returns {Array<object>}
 */
function readJsonl(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw.split('\n').filter(Boolean).map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

/**
 * Determine accuracy tag from an array of ledger entries for an agent.
 * Uses the most common accuracy value; falls back to 'approx'.
 * @param {Array<object>} entries
 * @returns {'high'|'approx'|'low'}
 */
function resolveAccuracyTag(entries) {
  const counts = { high: 0, approx: 0, low: 0 };
  for (const e of entries) {
    const acc = e.accuracy || 'approx';
    if (acc in counts) counts[acc]++;
    else counts.approx++;
  }
  // Pick the most common
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return sorted[0][0];
}

/**
 * Build token panel data from cost-ledger.jsonl.
 *
 * @param {string} metricsDir  - Absolute path to .bk-metrics directory
 * @returns {{
 *   agents: Array<{ agentType: string, tokensIn: number, tokensOut: number, cost_usd: number, accuracy: string }>,
 *   totals: { in: number, out: number, cost_usd: number }
 * }}
 */
function buildTokenPanel(metricsDir) {
  const ledgerPath = path.join(metricsDir, 'cost-ledger.jsonl');
  const entries = readJsonl(ledgerPath);

  if (entries.length === 0) {
    return { agents: [], totals: { in: 0, out: 0, cost_usd: 0 } };
  }

  // Group by agentType (field: agent)
  const byAgent = {};
  for (const entry of entries) {
    const agentType = entry.agent || entry.agentType || 'unknown';
    if (!byAgent[agentType]) {
      byAgent[agentType] = { tokensIn: 0, tokensOut: 0, cost_usd: 0, entries: [] };
    }
    byAgent[agentType].tokensIn  += entry.tokensIn  || 0;
    byAgent[agentType].tokensOut += entry.tokensOut || 0;
    byAgent[agentType].cost_usd  += entry.costUsd   || 0;
    byAgent[agentType].entries.push(entry);
  }

  // Sort by (tokensIn + tokensOut) descending, take top 3
  const agents = Object.entries(byAgent)
    .map(([agentType, data]) => ({
      agentType,
      tokensIn:  data.tokensIn,
      tokensOut: data.tokensOut,
      cost_usd:  Math.round(data.cost_usd * 10000) / 10000,
      accuracy:  resolveAccuracyTag(data.entries)
    }))
    .sort((a, b) => (b.tokensIn + b.tokensOut) - (a.tokensIn + a.tokensOut))
    .slice(0, 3);

  // Compute totals across ALL agents (not just top 3)
  const totals = Object.values(byAgent).reduce(
    (acc, data) => {
      acc.in      += data.tokensIn;
      acc.out     += data.tokensOut;
      acc.cost_usd += data.cost_usd;
      return acc;
    },
    { in: 0, out: 0, cost_usd: 0 }
  );
  totals.cost_usd = Math.round(totals.cost_usd * 10000) / 10000;

  return { agents, totals };
}

/**
 * Render the token panel as a string for display in the dashboard.
 * @param {{ agents: Array, totals: object }} panel
 * @returns {string}
 */
function renderTokenPanel(panel) {
  if (!panel || panel.agents.length === 0) {
    return '  (no cost ledger entries)';
  }

  const COL = { agent: 20, in: 8, out: 8, cost: 9, acc: 8 };

  function pad(s, w) {
    const str = String(s);
    return str.length >= w ? str.slice(0, w) : str + ' '.repeat(w - str.length);
  }

  const header = pad('Agent', COL.agent) + pad('In', COL.in) + pad('Out', COL.out) +
                 pad('Cost', COL.cost) + pad('Accuracy', COL.acc);
  const sep = '─'.repeat(COL.agent + COL.in + COL.out + COL.cost + COL.acc);

  const rows = panel.agents.map(a =>
    pad(a.agentType, COL.agent) +
    pad(shortTokens(a.tokensIn), COL.in) +
    pad(shortTokens(a.tokensOut), COL.out) +
    pad(`$${a.cost_usd.toFixed(2)}`, COL.cost) +
    pad(a.accuracy, COL.acc)
  );

  const totalsRow = pad('Total', COL.agent) +
    pad(shortTokens(panel.totals.in), COL.in) +
    pad(shortTokens(panel.totals.out), COL.out) +
    pad(`$${panel.totals.cost_usd.toFixed(2)}`, COL.cost);

  return [header, sep, ...rows, sep, totalsRow].join('\n');
}

module.exports = { buildTokenPanel, renderTokenPanel, shortTokens, readJsonl };
