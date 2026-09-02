/**
 * cmd-metrics.mjs — `mk metrics` command: display aggregated workflow metrics.
 *
 * Reads .bk-metrics/workflow-summary.jsonl and formats a summary table.
 * Options: --last N (default 7), --skill <name>
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Parse workflow-summary.jsonl into an array of objects.
 * @param {string} filePath
 * @returns {Array<Object>}
 */
function readSummaries(filePath) {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}

/**
 * Aggregate per-skill stats from summary entries.
 * @param {Array<Object>} entries
 * @returns {Array<Object>}
 */
function aggregateBySkill(entries) {
  const map = new Map();
  for (const e of entries) {
    const key = e.skill || 'unknown';
    if (!map.has(key)) {
      map.set(key, { skill: key, runs: 0, successes: 0, totalAgents: 0, totalFixLoops: 0, totalReactiveSignals: 0 });
    }
    const agg = map.get(key);
    agg.runs++;
    if (e.phase === 'commit' || e.phase === 'completed') agg.successes++;
    agg.totalAgents += e.total_agents || 0;
    agg.totalFixLoops += e.fix_loops || 0;
    agg.totalReactiveSignals += e.reactive_signals || 0;
  }
  return Array.from(map.values()).map(a => ({
    skill: a.skill,
    runs: a.runs,
    success_rate: a.runs > 0 ? `${Math.round((a.successes / a.runs) * 100)}%` : '0%',
    avg_agents: a.runs > 0 ? (a.totalAgents / a.runs).toFixed(1) : '0',
    avg_fix_loops: a.runs > 0 ? (a.totalFixLoops / a.runs).toFixed(1) : '0',
    reactive_signals: a.totalReactiveSignals
  }));
}

/**
 * Register the `metrics` command with commander.
 * @param {import('commander').Command} program
 */
export function registerMetrics(program) {
  program
    .command('metrics')
    .description('Display aggregated workflow telemetry metrics')
    .option('--last <n>', 'Show last N workflow entries', '7')
    .option('--skill <name>', 'Filter by skill name')
    .action((opts) => {
      const metricsFile = join(process.cwd(), '.bk-metrics', 'workflow-summary.jsonl');

      if (!existsSync(metricsFile)) {
        console.log('No metrics data found. Run a workflow first to collect telemetry.');
        console.log(`Expected: ${metricsFile}`);
        return;
      }

      let entries = readSummaries(metricsFile);

      if (entries.length === 0) {
        console.log('Metrics file exists but contains no entries.');
        return;
      }

      // Apply --skill filter
      if (opts.skill) {
        entries = entries.filter(e => (e.skill || '').includes(opts.skill));
        if (entries.length === 0) {
          console.log(`No entries found for skill: ${opts.skill}`);
          return;
        }
      }

      // Apply --last N (take last N entries)
      const last = parseInt(opts.last, 10) || 7;
      entries = entries.slice(-last);

      console.log(`\nmk metrics — last ${entries.length} workflow(s)${opts.skill ? ` (skill: ${opts.skill})` : ''}\n`);

      // Aggregate and display table
      const rows = aggregateBySkill(entries);

      if (typeof console.table === 'function') {
        console.table(rows);
      } else {
        // Manual formatting fallback
        const header = ['skill', 'runs', 'success_rate', 'avg_agents', 'avg_fix_loops', 'reactive_signals'];
        const colWidths = header.map(h => Math.max(h.length, ...rows.map(r => String(r[h] || '').length)));
        const fmt = (val, w) => String(val).padEnd(w);
        const separator = colWidths.map(w => '-'.repeat(w)).join('  ');
        console.log(header.map((h, i) => fmt(h, colWidths[i])).join('  '));
        console.log(separator);
        for (const row of rows) {
          console.log(header.map((h, i) => fmt(row[h] || '', colWidths[i])).join('  '));
        }
      }

      // Also show recent raw entries
      console.log('\nRecent workflow runs:');
      for (const e of entries) {
        const ts = e.ts ? new Date(e.ts).toLocaleString() : 'unknown';
        console.log(`  [${ts}] ${e.skill || '?'} / ${e.feature || '?'} — phase: ${e.phase || '?'}, agents: ${e.total_agents || 0}, fix_loops: ${e.fix_loops || 0}`);
      }
      console.log('');
    });
}
