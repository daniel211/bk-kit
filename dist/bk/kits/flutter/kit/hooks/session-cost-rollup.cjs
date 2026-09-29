#!/usr/bin/env node
// session-cost-rollup.cjs - Session-level cost rollup on Stop
// Trigger: Stop
// Purpose: Try reading stats-cache.json or spawning `claude /cost`, then append session rollup
//          to cost ledger. Compares with sum of subagent entries to log scale factor.
//
// Fail-open: all errors are caught, hook always exits 0.

'use strict';

try {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  const { createHookTimer } = require('./lib/hook-logger.cjs');
  const { appendEntry, resolveMetricsDir } = require('./lib/cost-ledger-writer.cjs');

  async function main() {
    const timer = createHookTimer('session-cost-rollup');
    try {
      const { isHookEnabled, readWorkflowState } = require('./lib/bk-config-utils.cjs');

      if (!isHookEnabled('session-cost-rollup')) {
        timer.end({ status: 'skipped', exit: 0 });
        process.exit(0);
      }

      // Re-entry guard, matching every other Stop hook in the kit (stop-lint-flush,
      // workflow-summary-flush, native-lint-flush). This hook never read stdin at all, so it had
      // no guard — which is why the field holds 49 `session` rows for a run with far fewer
      // Stops, 8 of 41 distinct minutes carrying more than one.
      let input = '';
      for await (const chunk of process.stdin) input += chunk;
      let data = {};
      try { data = JSON.parse(input || '{}'); } catch { data = {}; }
      if (data.stop_hook_active === true) {
        timer.end({ status: 'skipped', reason: 'stop_hook_active', exit: 0 });
        process.exit(0);
      }

      const state = readWorkflowState() || {};
      const workflowId = state.workflowId || state.workflow_id || null;

      // Try to get session cost from stats-cache.json
      const { costUsd: sessionCost, source } = await tryGetSessionCost();

      // Sum existing subagent ledger entries for comparison
      const { total: subagentSum, byWorkflow } = sumLedgerSubagentCosts();
      // Only a tally subagent-cost-capture has stamped as this workflow's. An unowned one is
      // a figure nobody can attribute: X-Game-Pro's state held $441.07 carried across
      // earlier features, and with no stats-cache every session row inherited it as costUsd.
      // Falling through to the ledger floor below is less wrong than copying that number.
      const { resolveWorkflowId, ownedCumulativeCost } = require('./lib/workflow-identity.cjs');
      const cumulativeFromState = ownedCumulativeCost(
        state, resolveWorkflowId(state, data.session_id || data.sessionId || null)) || 0;

      // Use best available data. The subagent ledger is the last resort rather than the first
      // because it under-counts the conductor's own turns — but reporting 0 while the ledger
      // holds real per-agent costs is worse than reporting a floor. All 165 field session
      // entries read costUsd: 0, which is what made the statusline show $0.00 for three days.
      const finalCost = sessionCost ?? (cumulativeFromState || subagentSum || 0);

      // Log scale factor if we have both data points
      if (sessionCost != null && subagentSum > 0) {
        const scaleFactor = Math.round((sessionCost / subagentSum) * 100) / 100;
        process.stderr.write(`[session-cost-rollup] scale-factor subagent/${source}: ${scaleFactor}x\n`);
      }

      // Cost per workflow, measured rather than inherited.
      //
      // `costUsd` and `subagentSumUsd` are SESSION cumulatives, but the row also stamps the
      // workflowId that happened to be current when the Stop fired, and a reader takes the two
      // together as "what this feature cost". The field shows what that does: trustcall_ios's
      // `commonalertvc-keywindow-fix` — a Trivial single-file fix with two agents — carries
      // costUsd 29.66 / subagentSumUsd 66.62, both inherited from the feature before it. Its own
      // cost is about 3.32, the sum of its own two subagent rows.
      //
      // So the scope is now stated rather than implied (`scope: 'session'`, and the two
      // cumulatives keep their names because statusline.computeCumulativeCost reads `costUsd`
      // off the last session row and adds the subagent rows after it), and the per-workflow
      // figure is its own field. `type: "subagent"` rows already carry the workflowId they were
      // actually dispatched under, so summing those per workflow is a measurement — nobody has
      // to subtract two cumulatives by hand to get it.
      const workflowCost = workflowId && byWorkflow.has(workflowId)
        ? byWorkflow.get(workflowId)
        : (workflowId ? 0 : null);

      const entry = {
        type: 'session',
        // Explicit: costUsd and subagentSumUsd below cover the whole session, not this workflow.
        scope: 'session',
        workflowId,
        // Sum of the subagent rows actually stamped with this workflowId. null when no workflow
        // was current — an unattributable cost is not zero, and must not read as zero.
        workflowSubagentUsd: workflowCost === null ? null : Math.round(workflowCost * 1e8) / 1e8,
        tokensIn: state.totalTokensIn || 0,
        tokensOut: state.totalTokensOut || 0,
        costUsd: finalCost != null ? Math.round(finalCost * 1e8) / 1e8 : null,
        // Sum of subagent rows across ALL workflows in the session. `subagentSumUsd` is the
        // legacy name for the same figure (it read as if per-workflow); kept so existing
        // readers and older ledger rows stay valid. Prefer `allWorkflowsSubagentUsd` and, for
        // one feature, `workflowSubagentUsd`.
        allWorkflowsSubagentUsd: Math.round(subagentSum * 1e8) / 1e8,
        subagentSumUsd: Math.round(subagentSum * 1e8) / 1e8,
        source: source || (cumulativeFromState ? 'state' : (subagentSum ? 'subagent-ledger' : 'state')),
        accuracy: sessionCost != null ? 'high' : 'approx',
        note: 'accuracy ±15-30%; thinking tokens not visible in JSONL'
      };

      appendEntry(entry);
      refreshUsageTotals();
      timer.end({ status: 'ok', source: entry.source, exit: 0 });
      process.exit(0);
    } catch (err) {
      timer.end({ status: 'error', error: err.message, exit: 0 });
      process.exit(0);
    }
  }

  /**
   * Fold this session's turns into the account-wide usage rollup that the
   * statusline's month-to-date and seven-day figures read.
   *
   * The statusline can refresh this itself, but only while someone is looking at
   * it — end of turn is the moment the transcript is complete, and it costs ~10ms
   * once the first scan is behind us. Skipped while the rollup is still fresh, so
   * a burst of short turns does not re-scan repeatedly.
   */
  function refreshUsageTotals() {
    try {
      const { readUsageRollup, refreshUsageRollup } = require('./lib/usage-rollup.cjs');
      const { loadHarnessPolicy } = require('./lib/harness-policy-loader.cjs');
      const tmCfg = loadHarnessPolicy().token_monitoring || {};
      if (tmCfg.statusline_show_usage_totals === false) return;

      const totals = readUsageRollup();
      const refreshMs = tmCfg.usage_rollup_refresh_ms || 300000;
      if (totals.updated !== null && totals.staleMs < refreshMs) return;

      refreshUsageRollup();
    } catch (err) {
      // Never let a spend figure hold up the end of a turn.
      process.stderr.write(`[session-cost-rollup] usage rollup skipped: ${err.message}\n`);
    }
  }

  /**
   * Attempt to read session cost from CC statusbar stats-cache.json.
   * Returns { costUsd: number|null, source: string }.
   */
  async function tryGetSessionCost() {
    // Try stats-cache.json in ~/.claude/projects/ subdirectory
    try {
      const projectsDir = path.join(os.homedir(), '.claude', 'projects');
      if (fs.existsSync(projectsDir)) {
        const entries = fs.readdirSync(projectsDir, { withFileTypes: true })
          .filter(e => e.isDirectory())
          .map(e => e.name)
          .sort()
          .reverse(); // most recent first

        for (const dir of entries.slice(0, 5)) {
          const cachePath = path.join(projectsDir, dir, 'stats-cache.json');
          if (fs.existsSync(cachePath)) {
            try {
              const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
              if (cache && typeof cache.totalCostUSD === 'number') {
                return { costUsd: cache.totalCostUSD, source: 'stats-cache' };
              }
              if (cache && typeof cache.cost === 'number') {
                return { costUsd: cache.cost, source: 'stats-cache' };
              }
            } catch { /* try next */ }
          }
        }
      }
    } catch (err) {
      process.stderr.write(`[session-cost-rollup] warn: stats-cache read failed: ${err.message}\n`);
    }

    // stats-cache not available — degrade gracefully
    return { costUsd: null, source: null };
  }

  /**
   * Sum costUsd from subagent entries in the current ledger, session-wide and per workflow.
   *
   * The per-workflow map is the whole point of the split: a subagent row is stamped with the
   * workflowId it was dispatched under, so grouping by it answers "what did this feature cost"
   * directly instead of leaving a reader to difference two session cumulatives.
   *
   * @returns {{ total: number, byWorkflow: Map<string, number> }} zeros if unreadable
   */
  function sumLedgerSubagentCosts() {
    const byWorkflow = new Map();
    try {
      const ledgerPath = path.join(resolveMetricsDir(), 'cost-ledger.jsonl');
      if (!fs.existsSync(ledgerPath)) return { total: 0, byWorkflow };
      const lines = fs.readFileSync(ledgerPath, 'utf8').split('\n').filter(Boolean);
      let sum = 0;
      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          if (obj.type !== 'subagent' || typeof obj.costUsd !== 'number') continue;
          sum += obj.costUsd;
          const wid = obj.workflowId || obj.workflow_id;
          if (wid) byWorkflow.set(wid, (byWorkflow.get(wid) || 0) + obj.costUsd);
        } catch { /* skip malformed */ }
      }
      return { total: sum, byWorkflow };
    } catch {
      return { total: 0, byWorkflow };
    }
  }

  main();
} catch (e) {
  // A DispatchExit is this hook's own process.exit() unwinding under bk-dispatch, not a
  // crash. Logging it here is how a clean run got filed as `status: "crash"`.
  if (e && e.bkDispatchExit) throw e;

  try {
    const fs = require('fs');
    const p = require('path');
    const logDir = p.join(__dirname, '.logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    try { const {appendJsonl: _ra} = require('./lib/jsonl-rotator.cjs'); _ra(p.join(logDir, 'hook-log.jsonl'), JSON.stringify({ ts: new Date().toISOString(), hook: 'session-cost-rollup', status: 'crash', error: e.message }) + '\n'); }
    catch(_e2) { fs.appendFileSync(p.join(logDir, 'hook-log.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), hook: 'session-cost-rollup', status: 'crash', error: e.message }) + '\n'); }
  } catch (_) {}
  process.exit(0);
}
