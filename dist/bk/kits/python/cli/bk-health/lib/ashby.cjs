'use strict';
/**
 * ashby.cjs — Ashby pre-flight sensor checks.
 *
 * Checks that harness sensors have recently fired.
 * Uses file mtime as a proxy for sensor activity.
 */

const fs = require('fs');
const path = require('path');
const { resolveCliProjectRoot } = require('./project-root.cjs');

const isTTY = process.stdout.isTTY;
const YELLOW = isTTY ? '\x1b[33m' : '';
const GREEN  = isTTY ? '\x1b[32m' : '';
const RESET  = isTTY ? '\x1b[0m'  : '';

function yellow(s) { return `${YELLOW}${s}${RESET}`; }
function green(s)  { return `${GREEN}${s}${RESET}`; }

/**
 * Configuration for each sensor check.
 * proxy: a file whose mtime indicates sensor activity.
 * violations_hook: if set, count violations.jsonl entries with this hook name.
 */
const SENSOR_CONFIGS = [
  {
    name: 'tool-repetition-detector',
    proxy: '.bk-metrics/tool-call-ring.json',
    description: 'Tool repetition detection'
  },
  {
    name: 'no-progress-detector',
    proxy: '.bk-metrics/file-edit-history.jsonl',
    description: 'No-progress / oscillation detection'
  },
  {
    name: 'fsm-guard',
    violations_hook: 'fsm-guard',
    description: 'FSM state machine guard'
  },
  {
    name: 'security-check',
    violations_hook: 'security-check',
    description: 'Security scan (protected files + secrets)'
  },
  {
    name: 'privacy-block',
    violations_hook: 'privacy-block',
    description: 'Privacy file access control'
  },
  {
    name: 'budget-guard',
    violations_hook: 'budget-guard',
    description: 'Budget limit enforcement'
  }
];

/**
 * Run Ashby checks for all sensors.
 * @param {{ projectRoot: string, silentDaysWarn?: number }} opts
 * @returns {{ warnings: Array, sensors: Array }}
 */
function runAshbyChecks(opts = {}) {
  const root = resolveCliProjectRoot(opts.projectRoot);
  const silentDaysWarn = opts.silentDaysWarn || 7;
  const windowMs = silentDaysWarn * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - windowMs;

  const metricsDir = path.join(root, '.bk-metrics');
  const violationsFile = path.join(metricsDir, 'violations.jsonl');

  // Load violations once for hook-specific lookups
  let allViolations = [];
  if (fs.existsSync(violationsFile)) {
    try {
      const raw = fs.readFileSync(violationsFile, 'utf8');
      allViolations = raw.split('\n').filter(Boolean).map(l => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean);
    } catch { /* fail-open */ }
  }

  const sensors = [];
  const warnings = [];

  for (const cfg of SENSOR_CONFIGS) {
    let lastActivity = null;
    let activityCount = 0;

    if (cfg.proxy) {
      const proxyPath = path.join(root, cfg.proxy);
      if (fs.existsSync(proxyPath)) {
        try {
          const stat = fs.statSync(proxyPath);
          lastActivity = stat.mtimeMs;
        } catch { /* ignore */ }
      }
      // Also count recent violations for this sensor
      activityCount = allViolations.filter(v => v.hook === cfg.name && v.ts >= cutoff).length;
    }

    if (cfg.violations_hook) {
      // Count violations in window
      const recentViolations = allViolations.filter(
        v => v.hook === cfg.violations_hook && v.ts >= cutoff
      );
      activityCount = recentViolations.length;
      if (recentViolations.length > 0) {
        lastActivity = Math.max(...recentViolations.map(v => v.ts));
      }
    }

    const active = lastActivity ? lastActivity >= cutoff : false;
    const sensor = {
      name: cfg.name,
      description: cfg.description,
      last_activity: lastActivity,
      activity_count: activityCount,
      active,
      silent: !active
    };
    sensors.push(sensor);

    // Generate warning if silent
    if (!active) {
      const warning = {
        source: cfg.name,
        severity: 'warning',
        message: `Sensor "${cfg.name}" silent for ${silentDaysWarn}d — may be disabled or project idle. Run \`./build.sh\` to reinstall hooks if expected.`
      };
      warnings.push(warning);
    }
  }

  return { warnings, sensors };
}

/**
 * Log new Ashby warnings to ashby-warnings.jsonl (dedup by source within 24h).
 */
function logAshbyWarnings(warnings, opts = {}) {
  const root = resolveCliProjectRoot(opts.projectRoot);
  const metricsDir = path.join(root, '.bk-metrics');
  if (!fs.existsSync(metricsDir)) fs.mkdirSync(metricsDir, { recursive: true });

  const warningsFile = path.join(metricsDir, 'ashby-warnings.jsonl');
  const ttl24h = 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - ttl24h;

  // Read existing warnings within 24h
  let existing = [];
  if (fs.existsSync(warningsFile)) {
    try {
      const raw = fs.readFileSync(warningsFile, 'utf8');
      existing = raw.split('\n').filter(Boolean).map(l => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(e => e && e.ts >= cutoff);
    } catch { /* fail-open */ }
  }

  const existingSources = new Set(existing.map(e => e.source));
  let logged = 0;

  for (const w of warnings) {
    if (!existingSources.has(w.source)) {
      const entry = { ts: Date.now(), ...w };
      fs.appendFileSync(warningsFile, JSON.stringify(entry) + '\n', 'utf8');
      logged++;
    }
  }

  return logged;
}

/**
 * Render Ashby check results as terminal string.
 */
function renderAshbyReport({ warnings, sensors }, opts = {}) {
  const lines = [];
  lines.push('ASHBY SENSOR HEALTH CHECK');
  lines.push('═'.repeat(70));

  const silentDays = opts.silentDaysWarn || 7;
  lines.push(`Window: last ${silentDays} days`);
  lines.push('');

  for (const s of sensors) {
    const status = s.active
      ? green(`✓ active  (${s.activity_count}× events)`)
      : yellow(`⚠ SILENT  (0× events in ${silentDays}d)`);
    const lastStr = s.last_activity
      ? new Date(s.last_activity).toISOString().slice(0, 19)
      : 'never';
    lines.push(`  ${s.name.padEnd(30)} ${status}`);
    lines.push(`    ${s.description} — last: ${lastStr}`);
  }

  lines.push('');
  lines.push('─'.repeat(70));

  if (warnings.length === 0) {
    lines.push(green('All sensors healthy.'));
  } else {
    lines.push(yellow(`${warnings.length} sensor warning(s):`));
    for (const w of warnings) {
      lines.push(yellow(`  ⚠ ${w.message}`));
    }
  }

  lines.push('═'.repeat(70));
  return lines.join('\n');
}

module.exports = { runAshbyChecks, logAshbyWarnings, renderAshbyReport, SENSOR_CONFIGS };
