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
 * The workflow a summary row belongs to.
 *
 * A row written since the workflow_id stamp carries it: `bk-code:crypto-module` for a skill
 * workflow (merges across sessions, as it should — a resumed feature is the same workflow) and
 * `session:<id>` for ad-hoc work (one workflow per session). See emitSummary in
 * hooks/_base/lib/workflow-summary.cjs.
 *
 * Grouping by (skill, feature) alone — the 0.10.1 rule — collapsed every ad-hoc session ever
 * run into one workflow, because they all write skill and feature "unknown". fusionworkomni's
 * insights.md read "Based on last 1 workflow(s) across 6 summary row(s) … Avg 14.0
 * agents/workflow" for six rows from several separate sessions.
 *
 * LEGACY ROWS (no workflow_id) cannot be split that way — they carry no session id, so there is
 * nothing to split on. The choice:
 *   - a legacy row WITH a known feature gets the key the writer would stamp today
 *     (`${skill || 'session'}:${feature}`, mirroring resolveWorkflowId), so a skill workflow
 *     whose close-outs straddle the upgrade still reads as one workflow;
 *   - a legacy row with feature "unknown" keeps the 0.10.1 (skill, feature) grouping, in a key
 *     space no stamped id can collide with. LIMITATION, stated plainly: pre-stamp ad-hoc rows
 *     inside the window still collapse into one workflow among themselves. They age out of the
 *     window; nothing on disk can recover their session.
 *
 * Kept in sync by hand with pattern-extractor.cjs, which cannot import this module.
 *
 * @param {Object} e — one workflow-summary.jsonl row
 * @returns {string}
 */
export function workflowKey(e) {
  if (typeof e.workflow_id === 'string' && e.workflow_id.trim()) return e.workflow_id.trim();
  const skill = e.skill && e.skill !== 'unknown' ? e.skill : '';
  const feature = e.feature && e.feature !== 'unknown' ? e.feature : '';
  if (feature) return `${skill || 'session'}:${feature}`;
  return `legacy\u0000${e.skill || 'unknown'}\u0000${e.feature || 'unknown'}`;
}

/**
 * Group summary rows into workflows by workflowKey (above).
 *
 * ONE SUMMARY ROW IS NOT ONE WORKFLOW, and never was. A feature is legitimately closed out more
 * than once: the terminal-phase edge trigger writes a row when the workflow first enters commit,
 * and the SessionEnd flush writes another for everything that happened afterwards. In the field,
 * `testable-import-linkage` dispatched 8 agents and produced exactly two correct rows —
 * total_agents 1 and 7. Treating each row as a run averaged them to 4.0 for a workflow that ran
 * 8. That cannot be fixed by writing rows more cleverly, because both rows are right; it has to
 * be fixed here, on the read side. Doing so also removes the "when is a workflow finished?"
 * question that produced two regressions in a row.
 *
 * But ONE (skill, feature) IS NOT ONE WORKFLOW EITHER — not for ad-hoc work, where every session
 * shares the key "unknown/unknown". That is why the key is the stamped workflow_id.
 *
 * Duration follows the em-dash contract: a workflow is measured if ANY of its rows carried a
 * measured duration, and unmeasured rows contribute nothing rather than zero.
 *
 * CAVEAT, deliberate and not a heuristic: a skill workflow's key is command:feature, grouped
 * within the rows handed to this function, i.e. within the selected window. The same feature
 * reopened weeks later is genuinely a second workflow, and grouping across all of time would
 * merge the two. The window is the bound. No time-gap rule is applied — inventing one would put
 * a guess where there is currently an honest limit.
 *
 * Kept in sync by hand with the same grouping in hooks/_base/pattern-extractor.cjs, which is
 * CommonJS inside the hook tree and cannot import this module.
 *
 * @param {Array<Object>} entries — rows from workflow-summary.jsonl
 * Ordered by each workflow's LAST row (file order, which is append order). Map insertion order
 * alone would be first-row order, and `--last N` would then drop a long-running skill workflow
 * that is still the most recently active one, just because an ad-hoc session opened after it.
 *
 * @param {Array<Object>} entries — rows from workflow-summary.jsonl
 * @returns {Array<Object>} one object per workflow, ordered by the position of its last row
 */
export function groupIntoWorkflows(entries) {
  const byKey = new Map();
  for (const [i, e] of entries.entries()) {
    const key = workflowKey(e);
    if (!byKey.has(key)) {
      byKey.set(key, {
        key, skill: e.skill || 'unknown', feature: e.feature || 'unknown', rows: 0,
        ts: e.ts || null,
        total_agents: 0, fix_loops: 0, reactive_signals: 0,
        total_duration_ms: 0, measured: false
      });
    }
    const wf = byKey.get(key);
    wf.rows++;
    wf.last_index = i;
    if (e.ts) wf.ts = e.ts;
    wf.total_agents += e.total_agents || 0;
    wf.fix_loops += e.fix_loops || 0;
    wf.reactive_signals += e.reactive_signals || 0;
    if (typeof e.total_duration_ms === 'number' && Number.isFinite(e.total_duration_ms)) {
      wf.total_duration_ms += e.total_duration_ms;
      wf.measured = true;
    }
  }
  return Array.from(byKey.values())
    .sort((a, b) => a.last_index - b.last_index)
    .map(({ last_index: _i, ...wf }) => ({
      ...wf,
      total_duration_ms: wf.measured ? wf.total_duration_ms : null
    }));
}

/**
 * Aggregate per-skill stats from summary entries.
 *
 * `avg_duration` averages only the runs that carry a measured duration, so a skill whose
 * runs were never measured reads `—` instead of being dragged toward zero.
 *
 * THERE IS NO success_rate COLUMN, deliberately. It used to count a run as a success when
 * `e.phase === 'commit' || e.phase === 'completed'` — and post-commit.cjs pins `current_phase`
 * at "commit" with nothing moving it back, so every summary row carries phase "commit": 8 of 8
 * across both field repos. The column could not print anything but 100%, including for a
 * sandbox run that contained a real fix loop (an agent reporting "Same error persists after the
 * third attempt"). A workflow summary records that work happened, not whether it went well —
 * "success" was never a thing this file measured, and a constant dressed as a rate is worse
 * than no column.
 *
 * `clean_run_rate` replaces it and is measured: a run is clean when it recorded neither a fix
 * loop nor a reactive signal. Both counts are now real — fix_loops counts the `fix_loop_stuck`
 * signals classified from each agent's final message plus the reviewer→implementer cycles in
 * the agent order (countReviewFixCycles in hooks/lib/workflow-summary.cjs), and
 * reactive_signals counts any row that raised a signal at all — so this varies with what
 * actually happened in the run.
 *
 * `runs` counts WORKFLOWS, not summary rows — see groupIntoWorkflows above for why those are
 * not the same thing. `clean_run_rate` therefore means "workflows with no fix loop and no
 * reactive signal across all of their rows".
 *
 * @param {Array<Object>} entries — rows from workflow-summary.jsonl
 * @returns {Array<Object>}
 */
export function aggregateBySkill(entries) {
  const map = new Map();
  for (const wf of groupIntoWorkflows(entries)) {
    const key = wf.skill || 'unknown';
    if (!map.has(key)) {
      map.set(key, {
        skill: key, runs: 0, cleanRuns: 0, totalAgents: 0, totalFixLoops: 0,
        totalReactiveSignals: 0, totalDurationMs: 0, measuredRuns: 0
      });
    }
    const agg = map.get(key);
    agg.runs++;
    const fixLoops = wf.fix_loops || 0;
    const reactive = wf.reactive_signals || 0;
    if (fixLoops === 0 && reactive === 0) agg.cleanRuns++;
    agg.totalAgents += wf.total_agents || 0;
    agg.totalFixLoops += fixLoops;
    agg.totalReactiveSignals += reactive;
    if (typeof wf.total_duration_ms === 'number' && Number.isFinite(wf.total_duration_ms)) {
      agg.totalDurationMs += wf.total_duration_ms;
      agg.measuredRuns++;
    }
  }
  return Array.from(map.values()).map(a => ({
    skill: a.skill,
    runs: a.runs,
    clean_run_rate: a.runs > 0 ? `${Math.round((a.cleanRuns / a.runs) * 100)}%` : '0%',
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
    .option('--last <n>', 'Show the last N workflows (a workflow may span several summary rows)', '7')
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

      // Apply --last N. N WORKFLOWS, not N rows: a workflow spans however many summary rows
      // its close-outs produced, and slicing rows would cut one in half and report the fragment
      // as a whole run.
      const last = parseInt(opts.last, 10) || 7;
      const keptWorkflows = groupIntoWorkflows(entries).slice(-last);
      // Keyed by the same workflowKey the grouping used, so the rows kept are exactly the rows
      // of the workflows kept — two ad-hoc sessions are two workflows here as well.
      const keptKeys = new Set(keptWorkflows.map((w) => w.key));
      entries = entries.filter((e) => keptKeys.has(workflowKey(e)));

      console.log(`\nbk metrics — last ${keptWorkflows.length} workflow(s)${opts.skill ? ` (skill: ${opts.skill})` : ''}\n`);

      // Aggregate and display table
      const rows = aggregateBySkill(entries);

      if (typeof console.table === 'function') {
        console.table(rows);
      } else {
        // Manual formatting fallback
        const header = ['skill', 'runs', 'clean_run_rate', 'avg_agents', 'avg_duration', 'avg_fix_loops', 'reactive_signals'];
        const colWidths = header.map(h => Math.max(h.length, ...rows.map(r => String(r[h] || '').length)));
        const fmt = (val, w) => String(val).padEnd(w);
        const separator = colWidths.map(w => '-'.repeat(w)).join('  ');
        console.log(header.map((h, i) => fmt(h, colWidths[i])).join('  '));
        console.log(separator);
        for (const row of rows) {
          console.log(header.map((h, i) => fmt(row[h] || '', colWidths[i])).join('  '));
        }
      }

      // Also show the raw rows behind the table — a workflow closed out twice shows both of
      // its rows here, which is what makes the grouped totals above checkable by hand.
      console.log('\nRecent workflow summary rows:');
      for (const e of entries) {
        console.log(formatWorkflowLine(e));
      }
      console.log('');
    });
}
