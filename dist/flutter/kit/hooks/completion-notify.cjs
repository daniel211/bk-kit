#!/usr/bin/env node
// completion-notify.cjs - Print completion summary when workflow finishes
// Trigger: Stop
// Purpose: Surface feature completion report to user in transcript
// Non-blocking (exit 0). Output via stdout plain text.

'use strict';

// Outer crash wrapper
try {
  const { createHookTimer } = require('./lib/hook-logger.cjs');
  const fs = require('fs');
  const path = require('path');
  const { resolveProjectRoot } = require('./lib/resolve-project-root.cjs');

  async function main() {
    const timer = createHookTimer('completion-notify');
    try {
      const { isHookEnabled, readWorkflowState } = require('./lib/bk-config-utils.cjs');

      if (!isHookEnabled('completion-notify')) {
        timer.end({ status: 'skipped', exit: 0 });
        process.exit(0);
      }

      // Consume stdin
      let input = '';
      for await (const chunk of process.stdin) input += chunk;

      // Check workflow state — only fire for completed/commit states
      const state = readWorkflowState();
      if (!state) {
        timer.end({ status: 'no_state', exit: 0 });
        process.exit(0);
      }

      const status = (state.status || state.current_phase || '').toLowerCase();
      if (!status.includes('commit') && !status.includes('complet')) {
        timer.end({ status: 'skip_not_complete', exit: 0 });
        process.exit(0);
      }

      // Find latest completion report
      const devDir = path.join(resolveProjectRoot(), 'mk', 'dev');
      let reportPath = null;
      let featureName = state.feature || 'unknown';

      if (fs.existsSync(devDir)) {
        // Look in feature-specific dir first
        if (featureName && featureName !== 'unknown') {
          const featureReport = path.join(devDir, featureName, 'completion-report.md');
          if (fs.existsSync(featureReport)) {
            reportPath = featureReport;
          }
        }

        // Fallback: scan all spec dirs for most recent completion-report.md
        if (!reportPath) {
          const dirs = fs.readdirSync(devDir)
            .filter(d => !d.startsWith('.') && d !== 'shared' && d !== 'archive')
            .sort().reverse();
          for (const dir of dirs) {
            const candidate = path.join(devDir, dir, 'completion-report.md');
            if (fs.existsSync(candidate)) {
              reportPath = candidate;
              featureName = featureName === 'unknown' ? dir : featureName;
              break;
            }
          }
        }
      }

      if (!reportPath) {
        timer.end({ status: 'no_report', exit: 0 });
        process.exit(0);
      }

      // Extract Summary section (first ~10 meaningful lines)
      const reportContent = fs.readFileSync(reportPath, 'utf8');
      const summaryLines = [];
      let inSummary = false;
      let lineCount = 0;

      for (const line of reportContent.split('\n')) {
        if (/^##\s+Summary/i.test(line)) {
          inSummary = true;
          continue;
        }
        if (inSummary) {
          if (/^##\s+/.test(line)) break; // Next section
          if (line.trim()) {
            summaryLines.push(line.trim());
            lineCount++;
            if (lineCount >= 10) break;
          }
        }
      }

      // Extract key fields for display
      const statusLine = summaryLines.find(l => /Status/i.test(l)) || '';
      const tierLine = summaryLines.find(l => /Tier/i.test(l)) || '';
      const statusVal = statusLine.replace(/.*:\*?\*?\s*/, '').replace(/\*+/g, '').trim() || 'Completed';
      const tierVal = tierLine.replace(/.*:\*?\*?\s*/, '').replace(/\*+/g, '').trim() || state.complexity_tier || 'Standard';

      // Format output banner
      const separator = '═'.repeat(47);
      const statusIcon = statusVal.toLowerCase().includes('complet') ? '✅' : '⚠️';
      const output = [
        separator,
        ` Feature Complete: ${featureName}`,
        ` Status: ${statusIcon} ${statusVal} | Tier: ${tierVal}`,
        ...(summaryLines.filter(l => !/Status|Tier|Platform/i.test(l)).slice(0, 3).map(l => ` ${l}`)),
        separator
      ].join('\n');

      process.stdout.write(output + '\n');

      timer.end({ status: 'ok', feature: featureName, exit: 0 });
      process.exit(0);
    } catch (err) {
      timer.end({ status: 'error', error: err.message, exit: 0 });
      process.exit(0);
    }
  }
  main();
} catch (e) {
  try {
    const fs = require('fs');
    const p = require('path');
    const logDir = p.join(__dirname, '.logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(p.join(logDir, 'hook-log.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), hook: 'completion-notify', status: 'crash', error: e.message }) + '\n');
  } catch (_) {}
  process.exit(0); // Fail-open
}
