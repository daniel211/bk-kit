/**
 * cost-by-model.cjs — the "## Cost by model" section of insights.md.
 *
 * Which model costs what: per model and per agent, from the subagent rows of cost-ledger.jsonl
 * (rows, USD, share of the total). For each model also the fix-loop rate of the workflows it ran
 * in, joined on workflowId (ledger) = workflow key (workflow-summary rows, see pattern-extractor's
 * workflowKey). A workflow that used two models counts for both, so the per-model rates overlap by
 * design — they answer "how often do workflows that used this model need a fix loop", not
 * "which model causes loops". The rate is withheld below the same sample floor the other
 * insights use; cost is always shown.
 *
 * Rows priced with the `unknown` fallback (pricing: "fallback") are real tokens at a guessed
 * rate, so they are totalled separately on the line they belong to and never read as exact.
 * Ledger rows without a model count under "unknown". No ledger or no subagent rows -> no section.
 *
 * Exports: readSubagentLedgerRows, summarizeCostByModel, renderCostByModel
 */

'use strict';

const fs = require('fs');

const TOP_N = 5;

/** Subagent rows of a ledger file; corrupt lines and other row types are skipped. */
function readSubagentLedgerRows(ledgerPath) {
  let raw = '';
  try { raw = fs.readFileSync(ledgerPath, 'utf8'); } catch { return []; }
  const rows = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try {
      const r = JSON.parse(line);
      if (r && r.type === 'subagent' && Number.isFinite(r.costUsd)) rows.push(r);
    } catch { /* skip corrupt line */ }
  }
  return rows;
}

function bump(map, key, row) {
  const cur = map.get(key) || { key, rows: 0, usd: 0, fbRows: 0, fbUsd: 0 };
  cur.rows++;
  cur.usd += row.costUsd;
  if (row.pricing === 'fallback') { cur.fbRows++; cur.fbUsd += row.costUsd; }
  map.set(key, cur);
  return cur;
}

/**
 * @param {object[]} rows — from readSubagentLedgerRows
 * @param {Map<string,{fix_loops:number}>} workflows — workflow key -> summed summary figures
 * @returns {null | { totalUsd:number, totalRows:number, fbRows:number, fbUsd:number,
 *   models:object[], agents:object[] }} null when there are no rows
 */
function summarizeCostByModel(rows, workflows) {
  if (!rows || rows.length === 0) return null;
  const models = new Map();
  const agents = new Map();
  const modelWorkflows = new Map(); // model -> Set(workflowId) that exist in the summary
  let totalUsd = 0;
  for (const r of rows) {
    const model = r.model || 'unknown';
    const agent = r.agent || 'unknown';
    totalUsd += r.costUsd;
    bump(models, model, r);
    const a = bump(agents, agent, r);
    (a.models || (a.models = new Set())).add(model);
    if (r.workflowId && workflows && workflows.has(r.workflowId)) {
      if (!modelWorkflows.has(model)) modelWorkflows.set(model, new Set());
      modelWorkflows.get(model).add(r.workflowId);
    }
  }
  const finish = (list) => list
    .sort((x, y) => y.usd - x.usd || y.rows - x.rows)
    .map((e) => ({ ...e, share: totalUsd > 0 ? e.usd / totalUsd : 0 }));
  const modelList = finish(Array.from(models.values())).map((m) => {
    const ids = modelWorkflows.get(m.key) || new Set();
    let withLoops = 0;
    for (const id of ids) if (workflows.get(id).fix_loops > 0) withLoops++;
    return { ...m, workflows: ids.size, workflowsWithFixLoops: withLoops };
  });
  const fb = rows.filter((r) => r.pricing === 'fallback');
  return {
    totalUsd,
    totalRows: rows.length,
    fbRows: fb.length,
    fbUsd: fb.reduce((s, r) => s + r.costUsd, 0),
    models: modelList,
    agents: finish(Array.from(agents.values())).map((a) => ({ ...a, models: Array.from(a.models).sort() }))
  };
}

const usd = (n) => `$${n.toFixed(2)}`;
const pct = (n) => `${Math.round(n * 100)}%`;
const fallbackNote = (e) => (e.fbRows > 0
  ? `; fallback-priced ${e.fbRows} row(s) ${usd(e.fbUsd)} (estimate)` : '');

/**
 * Markdown lines of the section ('' first), or [] when there is no data.
 * @param {ReturnType<typeof summarizeCostByModel>} summary
 * @param {{ minWorkflows?: number }} [opts] — workflows needed before a fix-loop rate is stated
 */
function renderCostByModel(summary, opts = {}) {
  if (!summary) return [];
  const minWorkflows = opts.minWorkflows || 5;
  const lines = [
    '',
    '## Cost by model',
    `- ${summary.totalRows} subagent ledger row(s), ${usd(summary.totalUsd)} total` +
      (summary.fbRows > 0
        ? ` — ${summary.fbRows} row(s) / ${usd(summary.fbUsd)} fallback-priced (unknown model rate, estimate)` : ''),
    '- By model (workflows = workflows the model ran in; a workflow can count for several models):'
  ];
  for (const m of summary.models.slice(0, TOP_N)) {
    let loops = '';
    if (m.workflows >= minWorkflows) {
      loops = `, fix-loop rate ${m.workflowsWithFixLoops}/${m.workflows} (${pct(m.workflowsWithFixLoops / m.workflows)})`;
    } else if (m.workflows > 0) {
      loops = `, ${m.workflows} workflow(s), no fix-loop rate (n<${minWorkflows})`;
    }
    lines.push(`  - ${m.key}: ${m.rows} row(s), ${usd(m.usd)} (${pct(m.share)})${loops}${fallbackNote(m)}`);
  }
  if (summary.models.length > TOP_N) lines.push(`  - … ${summary.models.length - TOP_N} more model(s)`);
  lines.push('- By agent:');
  for (const a of summary.agents.slice(0, TOP_N)) {
    lines.push(`  - ${a.key} [${a.models.join(', ')}]: ${a.rows} row(s), ${usd(a.usd)} (${pct(a.share)})${fallbackNote(a)}`);
  }
  if (summary.agents.length > TOP_N) lines.push(`  - … ${summary.agents.length - TOP_N} more agent(s)`);
  return lines;
}

module.exports = { readSubagentLedgerRows, summarizeCostByModel, renderCostByModel, TOP_N };
