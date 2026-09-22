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

  // Agents that must not modify project code but DO need Bash to drive an external
  // review harness. Bash is bounded by an allowlist rather than forbidden outright.
  const CODE_IMMUTABLE_AGENTS = new Set([
    'bk-gemini-reviewer'
  ]);

  // The harness itself, plus read-only inspection an agent may reasonably reach for
  // while assembling scope. Anything else is a violation.
  const HARNESS_BASH_ALLOWLIST = [
    /(?:^|[/\s;&|])agy(?:\s|$)/,                  // Antigravity CLI — the current harness
    /(?:^|[/\s;&|])gemini(?:\s|$)/,               // retired Gemini CLI, still tolerated
    /gemini-review\.mjs(?:\s|$)/,                 // the runner script
    // Availability probes. `where` is the Windows spelling the runner uses; omitting it
    // flagged every probe on Windows as a violation.
    /^\s*(?:which|command\s+-v|where|type)\s/,
    /^\s*git\s+(?:diff|status|log|show|ls-files|rev-parse|branch)\b/,
    /^\s*(?:ls|cat|head|tail|wc|find|grep|rg|pwd|echo)\b/
  ];

  /**
   * Best-effort extraction of Bash commands from an agent's returned transcript.
   * The transcript shape is not guaranteed, so a miss is possible — this reports
   * violations after the fact, it does not sandbox the agent.
   */
  function offAllowlistBashCommands(resultText) {
    const found = [];
    const cmdPattern = /"command"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
    let m;
    while ((m = cmdPattern.exec(resultText)) !== null) {
      let cmd;
      try {
        cmd = JSON.parse(`"${m[1]}"`);
      } catch (_) {
        cmd = m[1];
      }
      if (!HARNESS_BASH_ALLOWLIST.some(pat => pat.test(cmd))) {
        found.push(cmd.length > 120 ? `${cmd.slice(0, 117)}...` : cmd);
      }
    }
    return found;
  }

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
      } else if (CODE_IMMUTABLE_AGENTS.has(agentType)) {
        const resultText = typeof toolResponse === 'string'
          ? toolResponse
          : JSON.stringify(toolResponse);

        if (/"tool_name"\s*:\s*"Edit"/.test(resultText)) {
          errors.push(`[TOOL-RESTRICT] Read-only+Harness agent "${agentType}" used forbidden tool (Edit)`);
        }

        // Bash is granted for the review harness only — flag anything else.
        const strayCommands = offAllowlistBashCommands(resultText);
        for (const cmd of strayCommands) {
          errors.push(`[TOOL-RESTRICT] Agent "${agentType}" ran a Bash command outside the harness allowlist: ${cmd}`);
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

      /**
       * How long a recorded failure stays evidence about the run happening now.
       *
       * 2 hours. The counter feeds a signal that says "<agent> failed Nx on <feature>", which
       * the conductor acts on by dispatching a different agent — so it has to describe the work
       * in front of it. It did not: trustcall_ios still held
       * `bk-ios-developer:critical-security-fixes {count: 3}` from 2026-09-15 a week later,
       * because count is only ever reset by a success and nothing pruned the file. Reuse that
       * feature name weeks on and the FIRST stop fires agent_stuck with no failure in the
       * session at all.
       *
       * 2 hours is chosen to be longer than any plausible fix loop on one feature — the field's
       * longest single agent ran 638s, and a developer→reviewer→developer cycle is minutes, not
       * hours — and short enough that yesterday's failures cannot speak for today. Deliberately
       * not session-scoped: a compaction or a crash starts a new session mid-feature, and a
       * genuine repeat across that boundary is exactly what the signal is for.
       */
      const RETRY_EVIDENCE_TTL_MS = 2 * 60 * 60 * 1000;

      /** Enough to see the pattern, bounded so a state file users read stays readable. */
      const MAX_RECORDED_ERRORS = 5;

      /** Is this entry's last failure recent enough to still count? */
      function retryEvidenceIsFresh(entry, nowMs) {
        if (!entry || !entry.lastError) return false;
        const at = Date.parse(entry.lastError);
        return Number.isFinite(at) && (nowMs - at) < RETRY_EVIDENCE_TTL_MS;
      }

      function trackRetry(retryAgent, retryFeature, success, failureReasons) {
        let retryState = {};
        try { retryState = JSON.parse(fs.readFileSync(RETRY_STATE_FILE, 'utf8')); } catch (e) { /* new file */ }

        const nowMs = Date.now();

        // Prune every key whose evidence has aged out, not just this one. The file is read by
        // users and by `bk doctor`; leaving week-old counters in it is what made a stale entry
        // look like current state in the first place.
        for (const k of Object.keys(retryState)) {
          if (!retryEvidenceIsFresh(retryState[k], nowMs)) delete retryState[k];
        }

        const key = `${retryAgent}:${retryFeature}`;
        if (!retryState[key]) retryState[key] = { count: 0, errors: [] };

        if (!success) {
          retryState[key].count++;
          retryState[key].lastError = new Date(nowMs).toISOString();
          // `errors` was initialized and never written to: every field entry carried a timestamp
          // and an empty array, so nothing recorded WHAT failed. It now holds the most recent
          // rejection reasons, newest last, capped.
          const reasons = Array.isArray(failureReasons) ? failureReasons.filter(Boolean) : [];
          retryState[key].errors = [...(retryState[key].errors || []), ...reasons]
            .slice(-MAX_RECORDED_ERRORS);
        } else {
          retryState[key].count = 0; // Reset on success
          retryState[key].errors = [];
        }

        try { fs.writeFileSync(RETRY_STATE_FILE, JSON.stringify(retryState, null, 2)); } catch (e) { /* ignore */ }

        return retryState[key].count;
      }

      // Track retry count per agent+feature combination
      if (feature && agentType) {
        const outputValid = errors.length === 0;
        const retryCount = trackRetry(agentType, feature, outputValid, errors);
        if (retryCount >= 2) {
          const retrySignal =
            `[REACTIVE-SIGNAL: agent_stuck] (HIGH) "${agentType}" failed ${retryCount}x on "${feature}" — ` +
            'Task(bk-brainstormer). Detail: rules/reactive-orchestration.md §3.';
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

      // Five of a kind is enough to act on — a placeholder scan can produce one warning per
      // line, and the tail of that list never changed what the conductor had to do.
      const MAX_ITEMS = 5;
      const listOf = (items) => {
        const shown = items.slice(0, MAX_ITEMS).map((i) => `  - ${i}`);
        if (items.length > shown.length) shown.push(`  - (+${items.length - shown.length} more)`);
        return shown;
      };

      const lines = [];
      if (errors.length > 0) {
        lines.push(`[AGENT-OUTPUT-REJECTED] "${agentType}" — re-dispatch with a corrected prompt:`);
        lines.push(...listOf(errors));
      }
      if (warnings.length > 0) {
        lines.push(`[AGENT-OUTPUT-WARNING] "${agentType}":`);
        lines.push(...listOf(warnings));
      }

      // Advisory context is subject to the shared injection budget (cap + dedupe). Optional:
      // if the lib is absent the text goes out unchanged.
      let text = lines.join('\n');
      try {
        const injectionBudget = require('./lib/injection-budget.cjs');
        text = injectionBudget.prepareInjection('verify-output', text, {
          sessionId: injectionBudget.sessionIdFrom(data)
        });
      } catch { /* optional lib — keep the full text */ }

      if (text) process.stdout.write(JSON.stringify({ additionalContext: text }) + '\n');

      timer.end({ status: errors.length > 0 ? 'error' : 'warn', exit: 0 });
      process.exit(0);
    } catch (err) {
      timer.end({ status: 'error', error: err.message, exit: 0 });
      process.exit(0);
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
    try { const {appendJsonl: _ra} = require('./lib/jsonl-rotator.cjs'); _ra(p.join(logDir, 'hook-log.jsonl'), JSON.stringify({ ts: new Date().toISOString(), hook: 'verify-output', status: 'crash', error: e.message }) + '\n'); }
    catch(_e2) { fs.appendFileSync(p.join(logDir, 'hook-log.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), hook: 'verify-output', status: 'crash', error: e.message }) + '\n'); }
  } catch (_) {}
  process.exit(0);
}
