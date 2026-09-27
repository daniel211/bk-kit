#!/usr/bin/env node
'use strict';
/**
 * bk-health/index.cjs — Harness Dashboard & Health CLI
 *
 * Usage:
 *   node .claude/cli/bk-health/index.cjs --dashboard [--last <duration>] [--json]
 *   node .claude/cli/bk-health/index.cjs --timeline [--last <duration>] [--json]
 *   node .claude/cli/bk-health/index.cjs --ashby
 *   node .claude/cli/bk-health/index.cjs --resume [--force]
 *   node .claude/cli/bk-health/index.cjs --reset-counts [--agent <name>] [--force]
 *   node .claude/cli/bk-health/index.cjs --steer [--apply|--dry-run]
 *   node .claude/cli/bk-health/index.cjs --set-phase <phase> [--batch <N|next>] [--inc <field>]...
 *                                        [--field key=value]... [--session <id>]
 *   node .claude/cli/bk-health/index.cjs --batch <N|next>
 *
 * Duration format: Nh | Nd | Nm (e.g. 24h, 7d, 30m)
 */

const path = require('path');
const { getDashboardData, renderDashboard, parseDuration } = require('./lib/dashboard.cjs');
const { resolveCliProjectRoot } = require('./lib/project-root.cjs');
const { getTimelineEvents, renderTimeline } = require('./lib/timeline.cjs');
const { resumeWorkflow, resetCounts } = require('./lib/resume.cjs');
const { runAshbyChecks, logAshbyWarnings, renderAshbyReport } = require('./lib/ashby.cjs');
const { runSteerer } = require('../steerer-lib/index.cjs');
const { buildBehaviourPanel, renderBehaviourPanel } = require('./lib/behaviour.cjs');
const { verifySensors, renderVerifySensors } = require('./lib/verify-sensors.cjs');
const { drillDown } = require('./lib/subagent-drill-down.cjs');
const { setPhase } = require('./lib/set-phase.cjs');

// ─── Arg parsing ──────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = {
    dashboard: false,
    timeline: false,
    ashby: false,
    resume: false,
    resetCounts: false,
    mutationCheck: false,
    verifySensors: false,
    json: false,
    force: false,
    last: null,
    agent: null,
    subagentDrillDown: false,
    session: null,
    format: null,
    since: null
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--dashboard') flags.dashboard = true;
    else if (a === '--timeline') flags.timeline = true;
    else if (a === '--ashby') flags.ashby = true;
    else if (a === '--resume') flags.resume = true;
    else if (a === '--reset-counts') flags.resetCounts = true;
    else if (a === '--feature') flags.feature = args[++i];
    else if (a === '--mutation-check') flags.mutationCheck = true;
    else if (a === '--verify-sensors') flags.verifySensors = true;
    else if (a === '--json') flags.json = true;
    else if (a === '--force') flags.force = true;
    else if (a === '--last' && args[i + 1]) { flags.last = args[++i]; }
    else if (a === '--agent' && args[i + 1]) { flags.agent = args[++i]; }
    else if (a === '--subagent-drill-down') flags.subagentDrillDown = true;
    else if (a === '--session' && args[i + 1]) { flags.session = args[++i]; }
    else if (a === '--format' && args[i + 1]) { flags.format = args[++i]; }
    else if (a === '--since' && args[i + 1]) { flags.since = parseFloat(args[++i]); }
    else if (a === '--steer') flags.steer = true;
    else if (a === '--apply') flags.apply = true;
    else if (a === '--dry-run') flags.dryRun = true;
    else if (a === '--set-phase' && args[i + 1]) { flags.setPhase = args[++i]; }
    else if (a === '--batch' && args[i + 1]) { flags.batch = args[++i]; }
    else if (a === '--inc' && args[i + 1]) { (flags.inc = flags.inc || []).push(args[++i]); }
    else if (a === '--field' && args[i + 1]) { (flags.fields = flags.fields || []).push(args[++i]); }
  }

  // Default: --dashboard if no subcommand
  if (!flags.dashboard && !flags.timeline && !flags.ashby && !flags.resume && !flags.resetCounts && !flags.steer && !flags.mutationCheck && !flags.verifySensors && !flags.subagentDrillDown &&
      !flags.setPhase && flags.batch === undefined) {
    flags.dashboard = true;
  }

  return flags;
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const flags = parseArgs(process.argv);
  const projectRoot = resolveCliProjectRoot();

  // ── Set phase / advance batch (lib/set-phase.cjs) ─────────────────────
  // Before everything else: it is the one subcommand the conductor runs on every phase change,
  // so it prints one line (plus a recurrence advisory when there is one) and nothing more.
  if (flags.setPhase || flags.batch !== undefined) {
    const result = setPhase({
      projectRoot,
      phase: flags.setPhase || null,
      batch: flags.batch === undefined ? null : flags.batch,
      inc: flags.inc || [],
      fields: flags.fields || [],
      sessionId: flags.session || null
    });
    if (flags.json) {
      process.stdout.write(JSON.stringify(result) + '\n');
    } else if (result.success) {
      process.stdout.write(result.message + '\n' + (result.advisory ? result.advisory + '\n' : ''));
    } else {
      process.stderr.write(result.message + '\n');
    }
    process.exit(result.exitCode);
    return;
  }

  // ── Subagent Drill-Down ────────────────────────────────────────────────
  if (flags.subagentDrillDown) {
    try {
      const output = await drillDown({
        sessionId: flags.session || undefined,
        format: flags.format || 'text',
        sinceHours: flags.since || undefined,
        projectRoot
      });
      process.stdout.write(output + '\n');
      process.exit(0);
    } catch (err) {
      process.stderr.write(`[bk-health] subagent-drill-down error: ${err.message}\n`);
      process.exit(1);
    }
    return;
  }

  // Resolve time window
  const windowMs = flags.last ? parseDuration(flags.last) : null;
  const opts = { projectRoot, windowMs: windowMs || (24 * 60 * 60 * 1000) };

  // ── Dashboard ──────────────────────────────────────────────────────────
  if (flags.dashboard) {
    try {
      const data = getDashboardData(opts);
      if (flags.json) {
        process.stdout.write(JSON.stringify(data, null, 2) + '\n');
      } else {
        process.stdout.write(renderDashboard(data) + '\n');
      }
    } catch (err) {
      process.stderr.write(`[bk-health] Dashboard error: ${err.message}\n`);
      process.exit(1);
    }
    return;
  }

  // ── Timeline ───────────────────────────────────────────────────────────
  if (flags.timeline) {
    try {
      const events = getTimelineEvents(opts);
      if (flags.json) {
        process.stdout.write(JSON.stringify(events, null, 2) + '\n');
      } else {
        process.stdout.write(renderTimeline(events) + '\n');
      }
    } catch (err) {
      process.stderr.write(`[bk-health] Timeline error: ${err.message}\n`);
      process.exit(1);
    }
    return;
  }

  // ── Ashby ─────────────────────────────────────────────────────────────
  if (flags.ashby) {
    try {
      const result = runAshbyChecks({ projectRoot });
      logAshbyWarnings(result.warnings, { projectRoot });
      if (flags.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      } else {
        process.stdout.write(renderAshbyReport(result) + '\n');
      }
    } catch (err) {
      process.stderr.write(`[bk-health] Ashby error: ${err.message}\n`);
      process.exit(1);
    }
    return;
  }

  // ── Resume ────────────────────────────────────────────────────────────
  if (flags.resume) {
    try {
      const result = await resumeWorkflow({ projectRoot, force: flags.force });
      if (flags.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      } else {
        process.stdout.write(result.message + '\n');
      }
      process.exit(result.success ? 0 : 1);
    } catch (err) {
      process.stderr.write(`[bk-health] Resume error: ${err.message}\n`);
      process.exit(1);
    }
    return;
  }

  // ── Steerer (H3-03) ──────────────────────────────────────────────────
  if (flags.steer) {
    try {
      const result = runSteerer({
        projectRoot,
        dryRun: flags.dryRun === true,
        apply: flags.apply === true
      });
      if (flags.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      } else {
        const mode = flags.dryRun ? 'DRY-RUN' : (flags.apply ? 'APPLIED' : 'DRAFT');
        process.stdout.write(`[steerer] ${mode}\n`);
        process.stdout.write(`  Candidates: ${result.candidates?.length || 0}\n`);
        if (result.draftPath) process.stdout.write(`  Draft: ${result.draftPath}\n`);
        if (result.appliedCount != null) process.stdout.write(`  Applied: ${result.appliedCount} item(s)\n`);
        if (result.backupPath) process.stdout.write(`  Backup: ${result.backupPath}\n`);
        if (result.summary) process.stdout.write(`\n${result.summary}\n`);
      }
    } catch (err) {
      process.stderr.write(`[bk-health] Steerer error: ${err.message}\n`);
      process.exit(1);
    }
    return;
  }

  // ── Mutation check ─────────────────────────────────────────────────────
  if (flags.mutationCheck) {
    try {
      const metricsDir = path.join(projectRoot, '.bk-metrics');
      const panel = buildBehaviourPanel(metricsDir);
      const { mutationReadiness } = panel;
      if (flags.json) {
        process.stdout.write(JSON.stringify(mutationReadiness || {}, null, 2) + '\n');
      } else {
        if (!mutationReadiness) {
          process.stdout.write('[mutation-check] No mutation-readiness.json found. Run a manifest file edit to trigger scan.\n');
        } else {
          process.stdout.write('[mutation-check] Mutation testing readiness report:\n');
          for (const [platform, result] of Object.entries(mutationReadiness)) {
            if (platform === 'timestamp') continue;
            const icon = result.ready ? '\u2713' : '\u2717';
            const detail = result.ready ? `${result.tool} (${result.config})` : (result.hint || 'not configured');
            process.stdout.write(`  [${platform}] ${icon} ${detail}\n`);
          }
        }
      }
    } catch (err) {
      process.stderr.write(`[bk-health] mutation-check error: ${err.message}\n`);
      process.exit(1);
    }
    return;
  }

  // ── Verify sensors (Ashby's Law) ────────────────────────────────────────
  if (flags.verifySensors) {
    try {
      const result = verifySensors({ projectRoot, timeoutMs: 10000 });
      if (flags.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      } else {
        process.stdout.write(renderVerifySensors(result) + '\n');
      }
      process.exit(result.failed > 0 ? 1 : 0);
    } catch (err) {
      process.stderr.write(`[bk-health] verify-sensors error: ${err.message}\n`);
      process.exit(1);
    }
    return;
  }

  // ── Reset-counts ──────────────────────────────────────────────────────
  if (flags.resetCounts) {
    try {
      const result = await resetCounts({ projectRoot, force: flags.force, agent: flags.agent, feature: flags.feature });
      if (flags.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      } else {
        process.stdout.write(result.message + '\n');
      }
      process.exit(result.success ? 0 : 1);
    } catch (err) {
      process.stderr.write(`[bk-health] Reset-counts error: ${err.message}\n`);
      process.exit(1);
    }
    return;
  }
}

main().catch(err => {
  process.stderr.write(`[bk-health] Unexpected error: ${err.message}\n`);
  process.exit(1);
});
