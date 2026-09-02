#!/usr/bin/env node
// verify-output.cjs - Verify agent output files exist and check tool-restriction violations
// Trigger: PostToolUse (Task)
// Rewritten from package/.claude/hooks/verify-agent-output.sh

'use strict';

// Outer crash wrapper (catches require/parse failures)
try {
  const { createHookTimer } = require('./lib/hook-logger.cjs');
  const { resolveProjectRoot } = require('./lib/resolve-project-root.cjs');

  const READ_ONLY_AGENTS = new Set([
    'bk-code-reviewer', 'bk-security-auditor',
    'bk-performance-analyzer', 'bk-test-architect'
  ]);

  async function main() {
    const timer = createHookTimer('verify-output');
    try {
      const fs = require('fs');
      const { isHookEnabled, readWorkflowState, getOutputPath } = require('./lib/bk-config-utils.cjs');

      if (!isHookEnabled('verify-output')) {
        timer.end({ status: 'skipped', exit: 0 });
        process.exit(0);
      }

      let input = '';
      for await (const chunk of process.stdin) input += chunk;
      const data = JSON.parse(input || '{}');

      const toolInput = data.tool_input || {};
      const toolResponse = data.tool_response || {};
      const agentType = toolInput.subagent_type || toolInput.agent_type || '';

      // Skip unknown/non-kit agents
      if (!agentType) {
        timer.end({ status: 'ok', exit: 0 });
        process.exit(0);
      }

      const state = readWorkflowState();
      const feature = (state && state.feature) || null;
      const platform = process.env.BK_PLATFORM || (state && state.platform) || null;

      const errors = [];
      const warnings = [];

      // --- 1. Check expected output file exists ---
      if (feature) {
        const expectedPath = getOutputPath(agentType, feature, platform);
        if (!fs.existsSync(expectedPath)) {
          errors.push(`MISSING output file: ${expectedPath}`);
        } else {
          // Validate Markdown structure (header + metadata footer)
          const content = fs.readFileSync(expectedPath, 'utf8');
          if (!/^## /m.test(content)) {
            errors.push(`Report missing ## header: ${expectedPath}`);
          }
          if (!/<!-- metadata:/.test(content)) {
            warnings.push(`Report missing metadata footer: ${expectedPath}`);
          }
        }
      } else {
        warnings.push('Cannot verify output file — no feature in workflow state');
      }

      // --- 2. Tool-restriction check for read-only agents ---
      if (READ_ONLY_AGENTS.has(agentType)) {
        const resultText = typeof toolResponse === 'string'
          ? toolResponse
          : JSON.stringify(toolResponse);

        if (/"tool_name"\s*:\s*"(Edit|Bash)"/.test(resultText)) {
          errors.push(`[TOOL-RESTRICT] Read-only agent "${agentType}" used forbidden tool (Edit or Bash)`);
        }

        if (/"action"\s*:\s*"(modified|created|deleted)"/.test(resultText)) {
          warnings.push(`[TOOL-RESTRICT] Read-only agent "${agentType}" reports file modifications`);
        }
      }

      // --- 2b. Content quality check ---
      if (feature) {
        const expectedPath = getOutputPath(agentType, feature, platform);
        if (fs.existsSync(expectedPath)) {
          const qContent = fs.readFileSync(expectedPath, 'utf8');
          const qLines = qContent.split('\n');

          // Check minimum content length (not just format)
          if (qLines.length < 15) {
            warnings.push(`Report too short (${qLines.length} lines): ${expectedPath}`);
          }

          // Check for placeholder content
          const placeholderPatterns = [
            { pat: /\{\{.*\}\}/, label: 'Handlebars not rendered' },
            { pat: /TODO:/i,      label: 'Leftover TODO' },
            { pat: /TBD/i,        label: 'TBD placeholder' },
            { pat: /PLACEHOLDER/i, label: 'Explicit placeholder' },
          ];

          for (const line of qLines) {
            for (const { pat, label } of placeholderPatterns) {
              if (pat.test(line)) {
                warnings.push(`Possible placeholder in output (${label}): "${line.trim().substring(0, 60)}..."`);
                break;
              }
            }
          }

          // Check excessive "Not detected" fields
          const notDetectedMatches = qContent.match(/Not detected/gi);
          const notDetectedCount = notDetectedMatches ? notDetectedMatches.length : 0;
          if (notDetectedCount > 3) {
            warnings.push(`Too many "Not detected" fields (${notDetectedCount}) — scan may be incomplete`);
          }

          // Check for required sections based on agent type (fuzzy heading match)
          const requiredSections = {
            'bk-code-reviewer': [/^#{2,3}\s*findings/im, /^#{2,3}\s*summary/im],
            'bk-unit-test-agent': [/^#{2,3}\s*test\s*results?/im],
            'bk-security-auditor': [/^#{2,3}\s*vulnerabilit/im, /^#{2,3}\s*summary/im],
            'bk-performance-analyzer': [/^#{2,3}\s*findings/im, /^#{2,3}\s*summary/im],
          };

          const required = requiredSections[agentType];
          if (required) {
            for (const pattern of required) {
              if (!pattern.test(qContent)) {
                errors.push(`Missing required section matching ${pattern} in ${agentType} output`);
              }
            }
          }
        }
      }

      // --- 3. Worker preamble violation check ---
      if (agentType !== 'visual-orchestrator') {
        const resultText = typeof toolResponse === 'string'
          ? toolResponse
          : JSON.stringify(toolResponse);

        if (/dispatched\s(?:an\s)?agent|spawned\ssub-?agent|used?\sthe\sTask\stool/i.test(resultText)) {
          warnings.push(`[PREAMBLE-VIOLATION] Agent "${agentType}" appears to have dispatched sub-agents`);
        }
      }

      // --- 4. Retry tracking (reactive signal) ---
      const path = require('path');
      const RETRY_STATE_FILE = path.join(resolveProjectRoot(), 'bk', 'dev', 'shared', '.retry-state.json');

      function trackRetry(retryAgent, retryFeature, success) {
        let retryState = {};
        try { retryState = JSON.parse(fs.readFileSync(RETRY_STATE_FILE, 'utf8')); } catch (e) { /* new file */ }

        const key = `${retryAgent}:${retryFeature}`;
        if (!retryState[key]) retryState[key] = { count: 0, errors: [] };

        if (!success) {
          retryState[key].count++;
          retryState[key].lastError = new Date().toISOString();
        } else {
          retryState[key].count = 0; // Reset on success
        }

        try { fs.writeFileSync(RETRY_STATE_FILE, JSON.stringify(retryState, null, 2)); } catch (e) { /* ignore */ }

        return retryState[key].count;
      }

      // Track retry count per agent+feature combination
      if (feature && agentType) {
        const outputValid = errors.length === 0;
        const retryCount = trackRetry(agentType, feature, outputValid);
        if (retryCount >= 2) {
          const retrySignal = `[REACTIVE-SIGNAL: agent_stuck] (HIGH)\n` +
            `Agent "${agentType}" has failed ${retryCount} times for "${feature}". ` +
            'Consider dispatching bk-brainstormer for alternative approach. ' +
            'See rules/reactive-orchestration.md §3.';
          warnings.push(retrySignal);
        }
      }

      // --- 5. Agent telemetry: stop trace ---
      try {
        const { traceAgent } = require('./lib/agent-telemetry.cjs');
        traceAgent('stop', {
          agent: agentType,
          feature: feature || undefined,
          status: errors.length > 0 ? 'error' : 'ok',
          errors: errors.length,
          warnings: warnings.length
        });
      } catch { /* telemetry is best-effort */ }

      // --- Build additionalContext output ---
      if (errors.length === 0 && warnings.length === 0) {
        timer.end({ status: 'ok', exit: 0 });
        process.exit(0);
      }

      const lines = [];
      if (errors.length > 0) {
        lines.push(`[AGENT-OUTPUT-REJECTED] Agent "${agentType}" output has errors:`);
        errors.forEach(e => lines.push(`  - ${e}`));
        lines.push('ACTION: Re-dispatch agent with corrected prompt.');
      }
      if (warnings.length > 0) {
        lines.push(`[AGENT-OUTPUT-WARNING] Agent "${agentType}" warnings:`);
        warnings.forEach(w => lines.push(`  - ${w}`));
      }

      process.stdout.write(JSON.stringify({
        additionalContext: lines.join('\n')
      }) + '\n');

      timer.end({ status: errors.length > 0 ? 'error' : 'warn', exit: 0 });
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
    try { const {appendJsonl: _ra} = require('./lib/jsonl-rotator.cjs'); _ra(p.join(logDir, 'hook-log.jsonl'), JSON.stringify({ ts: new Date().toISOString(), hook: 'verify-output', status: 'crash', error: e.message }) + '\n'); }
    catch(_e2) { fs.appendFileSync(p.join(logDir, 'hook-log.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), hook: 'verify-output', status: 'crash', error: e.message }) + '\n'); }
  } catch (_) {}
  process.exit(0);
}
