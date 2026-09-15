/**
 * cmd-metrics.mjs — `bk metrics` command: display aggregated workflow metrics.
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
 * Render a measured duration in ms as a short human string.
 *
 * An unmeasured workflow renders as an em dash, never as `0s`. The summary writer emits
 * `total_duration_ms: null` with `duration_source: 'unavailable'` when no agent could be
 * matched to a subagent-live `stop` row, and printing that as `0s` would claim a measurement
 * that was never taken — the same failure the old `total_agents * 120` estimate made.
 *
 * @param {number|null|undefined} ms
 * @returns {string}
 */
export function formatDuration(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '—';
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/**
 * Aggregate per-skill stats from summary entries.
 *
 * `avg_duration` averages only the runs that carry a measured duration, so a skill whose
 * runs were never measured reads `—` instead of being dragged toward zero.
 *
 * @param {Array<Object>} entries
 * @returns {Array<Object>}
 */
export function aggregateBySkill(entries) {
  const map = new Map();
  for (const e of entries) {
    const key = e.skill || 'unknown';
    if (!map.has(key)) {
      map.set(key, {
        skill: key, runs: 0, successes: 0, totalAgents: 0, totalFixLoops: 0,
        totalReactiveSignals: 0, totalDurationMs: 0, measuredRuns: 0
      });
    }
    const agg = map.get(key);
    agg.runs++;
    if (e.phase === 'commit' || e.phase === 'completed') agg.successes++;
    agg.totalAgents += e.total_agents || 0;
    agg.totalFixLoops += e.fix_loops || 0;
    agg.totalReactiveSignals += e.reactive_signals || 0;
    if (typeof e.total_duration_ms === 'number' && Number.isFinite(e.total_duration_ms)) {
      agg.totalDurationMs += e.total_duration_ms;
      agg.measuredRuns++;
    }
  }
  return Array.from(map.values()).map(a => ({
    skill: a.skill,
    runs: a.runs,
    success_rate: a.runs > 0 ? `${Math.round((a.successes / a.runs) * 100)}%` : '0%',
    avg_agents: a.runs > 0 ? (a.totalAgents / a.runs).toFixed(1) : '0',
    avg_duration: a.measuredRuns > 0 ? formatDuration(a.totalDurationMs / a.measuredRuns) : '—',
    avg_fix_loops: a.runs > 0 ? (a.totalFixLoops / a.runs).toFixed(1) : '0',
    reactive_signals: a.totalReactiveSignals
  }));
}

/**
 * Render one workflow's detail line for the "Recent workflow runs" list.
 *
 * Extracted so the unmeasured case can be asserted without booting commander.
 *
 * @param {Object} e — one workflow-summary.jsonl entry
 * @returns {string}
 */
export function formatWorkflowLine(e) {
  const ts = e.ts ? new Date(e.ts).toLocaleString() : 'unknown';
  return `  [${ts}] ${e.skill || '?'} / ${e.feature || '?'} — phase: ${e.phase || '?'}, `
    + `agents: ${e.total_agents || 0}, duration: ${formatDuration(e.total_duration_ms)}, `
    + `fix_loops: ${e.fix_loops || 0}`;
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
        const header = ['skill', 'runs', 'success_rate', 'avg_agents', 'avg_duration', 'avg_fix_loops', 'reactive_signals'];
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
        console.log(formatWorkflowLine(e));
      }
      console.log('');
    });
}
