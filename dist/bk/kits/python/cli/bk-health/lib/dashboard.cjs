'use strict';
/**
 * dashboard.cjs — Aggregate and render harness dashboard data.
 *
 * Reads from .bk-metrics/*.jsonl + workflow-state and computes
 * a unified view of harness health.
 */

const fs = require('fs');
const path = require('path');
const { buildTokenPanel, renderTokenPanel } = require('./tokens.cjs');
const { buildInferentialPanel, renderInferentialPanel } = require('./inferential.cjs');
const { buildBehaviourPanel, renderBehaviourPanel } = require('./behaviour.cjs');
const { buildNativeLintPanel, renderNativeLintPanel } = require('./native-lint.cjs');
const { buildCiReadinessPanel, renderCiReadinessPanel } = require('./ci-readiness.cjs');
const { resolveCliProjectRoot } = require('./project-root.cjs');
const { requireHookLib } = require('./kit-hook-lib.cjs');

// ─── ANSI helpers ──────────────────────────────────────────────────────────
const isTTY = process.stdout.isTTY;
const RED    = isTTY ? '\x1b[31m' : '';
const YELLOW = isTTY ? '\x1b[33m' : '';
const GREEN  = isTTY ? '\x1b[32m' : '';
const RESET  = isTTY ? '\x1b[0m'  : '';

function red(s)    { return `${RED}${s}${RESET}`; }
function yellow(s) { return `${YELLOW}${s}${RESET}`; }
function green(s)  { return `${GREEN}${s}${RESET}`; }

// ─── File helpers ──────────────────────────────────────────────────────────

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

function readJson(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

// ─── Duration parser ───────────────────────────────────────────────────────

function parseDuration(str) {
  if (!str) return null;
  const m = str.match(/^(\d+)(h|d|m)$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const u = m[2];
  if (u === 'h') return n * 60 * 60 * 1000;
  if (u === 'd') return n * 24 * 60 * 60 * 1000;
  if (u === 'm') return n * 60 * 1000;
  return null;
}

// ─── Main aggregate function ───────────────────────────────────────────────

/**
 * Read and aggregate all harness data.
 * @param {{ projectRoot: string, windowMs?: number }} opts
 * @returns {object} aggregated data
 */
function getDashboardData(opts = {}) {
  const root = resolveCliProjectRoot(opts.projectRoot);
  const windowMs = opts.windowMs || (24 * 60 * 60 * 1000); // default 24h

  const metricsDir = path.join(root, '.bk-metrics');
  // Through the kit lib so a corrupt or deleted state file shows its recovered contents
  // rather than a clean empty dashboard.
  const kitLib = requireHookLib('bk-config-utils.cjs');
  const stateFile = kitLib && typeof kitLib.workflowStatePath === 'function'
    ? kitLib.workflowStatePath(root)
    : path.join(root, 'bk', 'dev', 'shared', '.workflow-state.json');

  const violations = readJsonlFiltered(path.join(metricsDir, 'violations.jsonl'), windowMs);
  const decisions  = readJsonlFiltered(path.join(metricsDir, 'decisions.jsonl'), windowMs);
  const redSignals = readJsonlFiltered(path.join(metricsDir, 'red-signals.jsonl'), windowMs);
  // Warning-only native-lint runs. Read alongside red signals but kept in their own array so
  // nothing downstream (halt weight, harness score) can accidentally fold them into a halt.
  const yellowSignals = readJsonlFiltered(path.join(metricsDir, 'yellow-signals.jsonl'), windowMs);
  const workflows  = readJsonlFiltered(path.join(metricsDir, 'workflow-summary.jsonl'), windowMs);
  const ashbyWarns = readJsonlFiltered(path.join(metricsDir, 'ashby-warnings.jsonl'), 24 * 60 * 60 * 1000);
  const state      = (kitLib && typeof kitLib.readWorkflowState === 'function'
    ? kitLib.readWorkflowState(root)
    : readJson(stateFile)) || {};

  // Token panel
  let tokenPanel = null;
  try { tokenPanel = buildTokenPanel(metricsDir); } catch { /* fail-open */ }

  // Inferential review panel
  let inferentialPanel = null;
  try { inferentialPanel = buildInferentialPanel(metricsDir); } catch { /* fail-open */ }

  // Behaviour harness panel
  let behaviourPanel = null;
  try { behaviourPanel = buildBehaviourPanel(metricsDir, windowMs); } catch { /* fail-open */ }

  // Native linting panel
  let nativeLintPanel = null;
  try { nativeLintPanel = buildNativeLintPanel(metricsDir); } catch { /* fail-open */ }

  // CI/CD readiness panel
  let ciReadinessPanel = null;
  try { ciReadinessPanel = buildCiReadinessPanel(metricsDir, { projectRoot: root }); } catch { /* fail-open */ }

  // Violation summary by rule
  const violationsByType = {};
  for (const v of violations) {
    const key = v.violation_type || v.hook || 'unknown';
    violationsByType[key] = (violationsByType[key] || 0) + 1;
  }

  // Red signal types
  const redSignalTypes = {};
  for (const r of redSignals) {
    redSignalTypes[r.type || 'unknown'] = (redSignalTypes[r.type || 'unknown'] || 0) + 1;
  }

  // What the kill-switch itself would see right now — not the same set as the 24h counts
  // above, and that difference is the point: a dashboard full of red entries that sum to
  // 0.75 is healthy, and nothing here used to say so.
  const redSignalWeight = buildRedSignalWeight(redSignals, state);

  // Phase recurrence
  const recurrenceCount = state.phase_recurrence_count || {};
  const phasesWithRecurrence = Object.entries(recurrenceCount)
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1]);

  // Compute a simple harness score (0-100)
  const harnessScore = computeHarnessScore({ violations, redSignals, state, ashbyWarns });

  return {
    state,
    violations,
    violationsByType,
    decisions,
    redSignals,
    redSignalTypes,
    redSignalWeight,
    yellowSignals,
    workflows,
    ashbyWarns,
    phasesWithRecurrence,
    harnessScore,
    tokenPanel,
    inferentialPanel,
    behaviourPanel,
    nativeLintPanel,
    ciReadinessPanel,
    windowMs,
    root
  };
}

/**
 * Weighted severity of the red signals inside the kill-switch's own lookback window.
 *
 * Mirrors global-kill-switch.cjs: distinct types, a weight each (a type absent from the
 * policy map counts 1.0), and everything a `--resume` or `--reset-counts` acknowledged
 * dropped. Returns null when the kit's hook lib is not next to the CLI, so the panel simply
 * omits the line.
 *
 * @param {Array<object>} redSignals - entries already filtered to the dashboard window
 * @param {object} state - workflow state
 * @returns {{weight: number, threshold: number, types: string[], lookbackMinutes: number,
 *            ackTs: number}|null}
 */
function buildRedSignalWeight(redSignals, state) {
  try {
    const loader = requireHookLib('harness-policy-loader.cjs');
    if (!loader || typeof loader.loadHarnessPolicy !== 'function') return null;
    const cfg = (loader.loadHarnessPolicy() || {}).kill_switch || {};

    const lookbackMinutes = cfg.lookback_minutes || 30;
    const cutoff = Date.now() - lookbackMinutes * 60 * 1000;
    const ackTs = typeof state.red_signal_ack_ts === 'number' ? state.red_signal_ack_ts : 0;
    const weights = cfg.red_signal_weights || {};
    const weightOf = (type) => {
      const w = weights[type];
      return typeof w === 'number' && isFinite(w) ? w : 1.0;
    };

    const types = [...new Set(redSignals
      .filter((r) => r && r.type && r.ts >= cutoff && !(ackTs && r.ts <= ackTs))
      .map((r) => r.type))];

    return {
      weight: types.reduce((sum, t) => sum + weightOf(t), 0),
      threshold: typeof cfg.min_signal_weight === 'number'
        ? cfg.min_signal_weight
        : (cfg.min_red_signals || 2),
      types,
      lookbackMinutes,
      ackTs
    };
  } catch { return null; }
}

function computeHarnessScore({ violations, redSignals, state, ashbyWarns }) {
  let score = 100;
  // Deduct for violations
  score -= Math.min(20, violations.length * 2);
  // Deduct for red signals
  score -= Math.min(20, redSignals.length * 3);
  // Deduct for halt
  if (state.global_halt) score -= 30;
  if (state.workflow_paused) score -= 10;
  // Deduct for ashby warnings
  score -= Math.min(10, ashbyWarns.length * 5);
  return Math.max(0, score);
}

// ─── Dashboard renderer ────────────────────────────────────────────────────

const BOX_WIDTH = 74;

/**
 * Render a measured workflow duration (ms) for the WORKFLOWS panel.
 * Unmeasured (null) renders as an em dash — never as `0s`, which would claim a measurement
 * that was never taken.
 */
function formatWorkflowDuration(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '—';
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function boxTop(title) {
  const titleStr = title ? ` ${title} ` : '';
  const totalFill = BOX_WIDTH - 2 - titleStr.length;
  const left  = Math.floor(totalFill / 2);
  const right = totalFill - left;
  return `\u2554${'═'.repeat(left)}${titleStr}${'═'.repeat(right)}\u2557`;
}

function boxMid(label) {
  return `\u2560${'═'.repeat(BOX_WIDTH - 2)}\u2563\n\u2551 ${label}${' '.repeat(Math.max(0, BOX_WIDTH - 4 - label.length))} \u2551`;
}

function boxLine(text) {
  const display = text.replace(/\x1b\[[0-9;]*m/g, '');
  const pad = Math.max(0, BOX_WIDTH - 4 - display.length);
  return `\u2551 ${text}${' '.repeat(pad)} \u2551`;
}

function boxBottom() {
  return `\u255a${'═'.repeat(BOX_WIDTH - 2)}\u255d`;
}

function divider() {
  return `\u2560${'═'.repeat(BOX_WIDTH - 2)}\u2563`;
}

/**
 * Render dashboard as terminal string.
 * @param {object} data - from getDashboardData()
 * @returns {string}
 */
function renderDashboard(data) {
  const { state, violations, violationsByType, decisions, redSignals,
          redSignalTypes, redSignalWeight, yellowSignals, workflows, ashbyWarns, phasesWithRecurrence,
          harnessScore, tokenPanel, inferentialPanel, behaviourPanel,
          nativeLintPanel, ciReadinessPanel, windowMs } = data;

  const windowHours = Math.round(windowMs / (60 * 60 * 1000));
  const windowLabel = windowHours >= 24 ? `${Math.round(windowHours/24)}d` : `${windowHours}h`;

  const lines = [];

  // Header
  lines.push(boxTop(`BEER KIT HARNESS DASHBOARD · Window: last ${windowLabel}`));

  // Status section
  lines.push(divider());
  lines.push(boxLine('STATUS'));
  lines.push(boxLine('──────'));
  const haltStr   = state.global_halt ? red('YES ⛔') : green('NO');
  const pauseStr  = state.workflow_paused ? yellow('PAUSED') : '—';
  lines.push(boxLine(`Global halt:    ${haltStr}     Paused workflow:  ${pauseStr}`));
  const feature  = state.feature || '—';
  const phase    = state.current_phase || 'idle';
  lines.push(boxLine(`Active feature: ${feature}  Phase: ${phase}`));
  const phHistory = (state.phase_history || []).slice(-5).map(h => h.phase || '?').join(' → ');
  if (phHistory) {
    lines.push(boxLine(`Phase history:  ${phHistory}`));
  }
  if (state.halt_reasons && state.halt_reasons.length > 0) {
    lines.push(boxLine(`Halt reasons:   ${state.halt_reasons.slice(0, 2).join(', ')}`));
  }

  // Harness score
  lines.push(divider());
  lines.push(boxLine('HARNESS HEALTH'));
  lines.push(boxLine('──────────────'));
  const scoreColor = harnessScore >= 80 ? green : harnessScore >= 50 ? yellow : red;
  lines.push(boxLine(`Health score: ${scoreColor(String(harnessScore) + '/100')}`));

  // Violations
  lines.push(divider());
  lines.push(boxLine(`VIOLATIONS (${windowLabel})`));
  lines.push(boxLine('──────────────────'));
  if (violations.length === 0) {
    lines.push(boxLine(green('No violations — all clear')));
  } else {
    lines.push(boxLine(`Total: ${violations.length}`));
    for (const [type, count] of Object.entries(violationsByType).slice(0, 5)) {
      lines.push(boxLine(`  ${type}: ${count}`));
    }
  }

  // Red signals
  lines.push(divider());
  lines.push(boxLine(`RED SIGNALS (${windowLabel})`));
  lines.push(boxLine('──────────────────'));
  if (redSignals.length === 0) {
    lines.push(boxLine(green('No red signals')));
  } else {
    for (const [type, count] of Object.entries(redSignalTypes).slice(0, 5)) {
      lines.push(boxLine(`  ${type}: ${count}`));
    }
  }
  if (redSignalWeight) {
    // The number the kill-switch actually thresholds on. The counts above are an audit
    // trail; this one line says whether a halt is close.
    const { weight, threshold, lookbackMinutes, ackTs } = redSignalWeight;
    const wStr = `${weight.toFixed(2)} / ${threshold.toFixed(2)}`;
    const colour = weight >= threshold ? red : weight >= threshold - 1 ? yellow : green;
    lines.push(boxLine(`Halt weight (last ${lookbackMinutes}m): ${colour(wStr)}`));
    if (ackTs) {
      lines.push(boxLine(`Acknowledged:   ${new Date(ackTs).toISOString()} (earlier signals ignored)`));
    }
  }
  // Lives in the RED SIGNALS box because that is where a reader looks for lint fallout, but
  // never rendered red: these are recorded for the audit trail and cannot cause a halt.
  if ((yellowSignals || []).length > 0) {
    lines.push(boxLine(yellow(`Warnings (lint, non-halting): ${yellowSignals.length}`)));
  }

  // Phase recurrence
  if (phasesWithRecurrence.length > 0) {
    lines.push(divider());
    lines.push(boxLine('PHASE RECURRENCE WARNINGS'));
    lines.push(boxLine('─────────────────────────'));
    for (const [phase, count] of phasesWithRecurrence.slice(0, 3)) {
      lines.push(boxLine(yellow(`  ${phase}: entered ${count}×`)));
    }
  }

  // Recent decisions
  lines.push(divider());
  lines.push(boxLine(`RECENT DECISIONS (last 5, ${windowLabel})`));
  lines.push(boxLine('─────────────────────────────────────'));
  if (decisions.length === 0) {
    lines.push(boxLine('No decisions recorded'));
  } else {
    for (const d of decisions.slice(-5).reverse()) {
      const agent = d.agent || '?';
      const dec   = (d.decision || '?').slice(0, 50);
      const scope = d.scope ? ` (${d.scope})` : '';
      lines.push(boxLine(`[${agent}] ${dec}${scope}`));
    }
  }

  // Tokens & Cost panel
  if (tokenPanel) {
    lines.push(divider());
    lines.push(boxLine('TOKENS & COST'));
    lines.push(boxLine('─────────────'));
    const panelStr = renderTokenPanel(tokenPanel);
    for (const row of panelStr.split('\n')) {
      lines.push(boxLine(row));
    }
  }

  // Budget (from workflow-summary)
  if (workflows.length > 0) {
    lines.push(divider());
    lines.push(boxLine(`WORKFLOWS (${windowLabel})`));
    lines.push(boxLine('───────────'));
    for (const w of workflows.slice(-3).reverse()) {
      const feat = w.feature || '?';
      const agents = w.total_agents || 0;
      const fixl   = w.fix_loops || 0;
      // Measured elapsed time, from the summary's total_duration_ms. An unmeasured workflow
      // shows an em dash rather than 0s — the writer emits null when no agent matched a
      // subagent-live `stop` row.
      const dur    = formatWorkflowDuration(w.total_duration_ms);
      lines.push(boxLine(`  ${feat}: ${agents} agents, ${dur}, ${fixl} fix loops`));
    }
  }

  // Inferential Review panel
  if (inferentialPanel) {
    lines.push(divider());
    lines.push(boxLine('INFERENTIAL REVIEW'));
    lines.push(boxLine('──────────────────'));
    const panelLines = renderInferentialPanel(inferentialPanel);
    for (const row of panelLines) {
      // Colorise fail indicators
      const colored = row.startsWith('  ✗') ? red(row) : (row.startsWith('  ✓') ? green(row) : row);
      lines.push(boxLine(colored));
    }
  }

  // Behaviour Harness panel
  if (behaviourPanel) {
    lines.push(divider());
    lines.push(boxLine('BEHAVIOUR HARNESS'));
    lines.push(boxLine('─────────────────'));
    const panelLines = renderBehaviourPanel(behaviourPanel);
    for (const row of panelLines) {
      const colored = row.includes('\u2717') ? red(row) : (row.includes('\u2713') ? green(row) : row);
      lines.push(boxLine(colored));
    }
  }

  // Native Linting panel
  if (nativeLintPanel) {
    lines.push(divider());
    lines.push(boxLine('NATIVE LINTING'));
    lines.push(boxLine('──────────────'));
    const panelLines = renderNativeLintPanel(nativeLintPanel);
    for (const row of panelLines) {
      const colored = row.includes('\u2717') ? red(row) : (row.includes('\u2713') ? green(row) : row);
      lines.push(boxLine(colored));
    }
  }

  // CI/CD Readiness panel
  if (ciReadinessPanel) {
    lines.push(divider());
    lines.push(boxLine('CI/CD READINESS'));
    lines.push(boxLine('───────────────'));
    const panelLines = renderCiReadinessPanel(ciReadinessPanel);
    for (const row of panelLines) {
      const colored = row.includes('\u2717') || row.startsWith('  ✗') ? red(row)
        : row.includes('\u2713') || row.startsWith('  ✓') ? green(row)
        : row.startsWith('  ⚠') ? yellow(row)
        : row;
      lines.push(boxLine(colored));
    }
  }

  // Ashby warnings
  if (ashbyWarns.length > 0) {
    lines.push(divider());
    lines.push(boxLine('ASHBY SENSOR WARNINGS'));
    lines.push(boxLine('─────────────────────'));
    for (const w of ashbyWarns.slice(0, 3)) {
      lines.push(boxLine(yellow(`⚠ ${(w.message || w.source || 'sensor warning').slice(0, 65)}`)));
    }
  }

  // Footer
  lines.push(divider());
  lines.push(boxLine('Run with --timeline for event timeline | --ashby for sensor details'));
  if (state.global_halt || state.workflow_paused) {
    lines.push(boxLine(yellow('Run with --resume to clear halt/paused state')));
  }
  lines.push(boxBottom());

  return lines.join('\n');
}

module.exports = { getDashboardData, renderDashboard, parseDuration, computeHarnessScore, buildCiReadinessPanel, renderCiReadinessPanel };
