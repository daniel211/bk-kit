#!/usr/bin/env node
// delegation-enforcer.cjs - Validate Task dispatch and inject platform context
// Trigger: PreToolUse (Task)
// Rewritten from package/.claude/hooks/delegation-enforcer.sh

'use strict';

// Outer crash wrapper (catches require/parse failures)
try {
  const { createHookTimer } = require('./lib/hook-logger.cjs');
  const { resolveProjectRoot } = require('./lib/resolve-project-root.cjs');
  const path = require('path');

  // Known valid agent types for beer-kit v2 (bk- prefixed)
  const KNOWN_AGENTS = new Set([
    'bk-ios-developer', 'bk-android-developer', 'bk-flutter-developer',
    'bk-code-reviewer', 'bk-gemini-reviewer', 'bk-security-auditor', 'bk-performance-analyzer',
    'bk-unit-test-agent', 'bk-device-test-agent', 'bk-test-architect',
    'bk-debugger', 'bk-researcher',
    'design-validator', 'design-spec-writer', 'design-asset-exporter',
    'bk-docs-writer', 'bk-git-manager', 'bk-planner',
    'bk-brainstormer', 'bk-code-simplifier', 'bk-project-manager'
  ]);

  // Advisory context is subject to the shared injection budget (cap + dedupe). Optional:
  // if the lib is absent the text goes out unchanged.
  let injectionBudget = null;
  try { injectionBudget = require('./lib/injection-budget.cjs'); } catch { /* optional */ }

  /** Emit advisory additionalContext through the budget, staying silent when it says so. */
  function emitAdvisory(text, data) {
    let out = text;
    if (injectionBudget) {
      try {
        out = injectionBudget.prepareInjection('delegation-enforcer', text, {
          sessionId: injectionBudget.sessionIdFrom(data)
        });
      } catch { out = text; }
    }
    if (out) process.stdout.write(JSON.stringify({ additionalContext: out }) + '\n');
  }

  // --- Task 3.1A: Required sections validation for dispatch prompts ---
  const REQUIRED_PROMPT_SECTIONS = ['Task:', 'Output:'];
  const RECOMMENDED_PROMPT_SECTIONS = ['Platform:', 'Files:'];

  function validateDispatchPrompt(prompt) {
    const missing = REQUIRED_PROMPT_SECTIONS.filter(s => !prompt.includes(s));
    const missingRecommended = RECOMMENDED_PROMPT_SECTIONS.filter(s => !prompt.includes(s));

    return {
      valid: missing.length === 0,
      missing,
      missingRecommended,
      message: missing.length > 0
        ? `Dispatch prompt missing required sections: ${missing.join(', ')}. Include Task: and Output: sections.`
        : null
    };
  }

  // --- Task 3.1C: File ownership pre-check for parallel dispatch ---
  function checkFileOwnership(prompts) {
    const ownership = {};
    const conflicts = [];

    for (const [idx, prompt] of prompts.entries()) {
      // Extract file paths from "Files:", "Output:", or "owns:" sections
      const filePattern = /(?:Files?|Output|owns?):\s*([^\n]+)/gi;
      let match;
      while ((match = filePattern.exec(prompt)) !== null) {
        const files = match[1].split(',').map(f => f.trim());
        for (const file of files) {
          if (ownership[file] !== undefined) {
            conflicts.push({ file, agents: [ownership[file], idx] });
          }
          ownership[file] = idx;
        }
      }
    }

    return { hasConflicts: conflicts.length > 0, conflicts };
  }

  async function main() {
    const timer = createHookTimer('delegation-enforcer');
    try {
      const { isHookEnabled, readWorkflowState, readPlatformContext } = require('./lib/bk-config-utils.cjs');

      if (!isHookEnabled('delegation-enforcer')) {
        timer.end({ status: 'skipped', exit: 0 });
        process.exit(0);
      }

      let input = '';
      for await (const chunk of process.stdin) input += chunk;
      const data = JSON.parse(input || '{}');

      const toolInput = data.tool_input || {};
      const agentType = toolInput.subagent_type || toolInput.agent_type || '';
      const prompt = toolInput.prompt || '';

      // Skip non-kit agents, but warn on unknown bk-* prefixed agents
      if (!agentType || !KNOWN_AGENTS.has(agentType)) {
        if (agentType && agentType.startsWith('bk-')) {
          // The full roster used to be pasted in here — ~1.4 KB of agent names on every typo.
          // The names are already in .claude/agents/, which the model can list on demand.
          emitAdvisory(
            `[DISPATCH-WARN] "${agentType}" is not a kit agent — check the names in .claude/agents/.`,
            data
          );
        }
        timer.end({ status: 'ok', exit: 0 });
        process.exit(0);
      }

      const state = readWorkflowState();
      const platformCtx = readPlatformContext();

      // Prefer env vars (propagated by session-init) over re-detection
      const platform = process.env.BK_PLATFORM
        || (state && state.platform)
        || (platformCtx && platformCtx.platform)
        || 'unknown';

      const feature = (state && state.feature) || null;
      const phase = process.env.BK_WORKFLOW_PHASE
        || (state && state.current_phase) || null;

      // Build advisory context — only inject what subagent-init DOESN'T provide
      // subagent-init already covers: Agent, Platform, Project, Plan, Rules, Naming
      const contextParts = [];
      const cwd = resolveProjectRoot();

      // Read-only agents: warn if prompt lacks tool restriction
      const READ_ONLY_AGENTS = new Set([
        'bk-code-reviewer', 'bk-security-auditor',
        'bk-performance-analyzer', 'bk-test-architect'
      ]);

      if (READ_ONLY_AGENTS.has(agentType)) {
        contextParts.push('TOOL RESTRICTION: Read-only agent. Do NOT use Edit, Bash, or Task tools.');
      }

      // Foreground-only agents: warn if dispatched as background (CR-P1-12, CR-P1-15)
      const FOREGROUND_AGENTS = new Set(['bk-ios-developer', 'bk-android-developer', 'bk-flutter-developer', 'bk-planner']);
      if (FOREGROUND_AGENTS.has(agentType) && toolInput.run_in_background === true) {
        contextParts.push(`[DISPATCH-WARN] Agent "${agentType}" requires foreground mode for MCP access. Background dispatch will lose MCP tools.`);
      }

      // C. Output path injection for reporting agents
      const OUTPUT_AGENTS = new Set([
        'bk-unit-test-agent', 'bk-device-test-agent', 'bk-code-reviewer',
        'bk-gemini-reviewer', 'bk-security-auditor', 'bk-performance-analyzer', 'bk-test-architect'
      ]);
      if (OUTPUT_AGENTS.has(agentType) && feature) {
        const outputMap = {
          'bk-unit-test-agent': `unit-test-${platform || 'unknown'}-${feature}.md`,
          'bk-device-test-agent': `device-test-${platform || 'unknown'}-${feature}.md`,
          'bk-code-reviewer': `code-review-${feature}.md`,
          // Distinct path so dual-engine review keeps both models' reports.
          'bk-gemini-reviewer': `code-review-gemini-${feature}.md`,
          'bk-security-auditor': `security-${feature}.md`,
          'bk-performance-analyzer': `performance-${feature}.md`,
          'bk-test-architect': `test-strategy-${feature}.md`
        };
        const outputFile = outputMap[agentType];
        if (outputFile) {
          contextParts.push(`Output: ${path.join(cwd, 'bk', 'dev', 'shared', 'reports', outputFile)}`);
        }
      }

      // Warn if prompt missing key sections (advisory only)
      const warnings = [];
      // missing_platform is checked only where it can matter, and only when nothing else
      // supplies the platform.
      //
      // X-Game-Pro, 0.12.1, one session: 72 "[DISPATCH-WARN] Prompt may be incomplete:
      // missing_platform", mostly for agents whose work has no platform in it — bk-git-manager
      // (7), bk-code-reviewer (5), bk-security-auditor (4), bk-project-manager (3),
      // bk-performance-analyzer (2), bk-docs-writer, bk-planner. A warning on every dispatch is
      // one the conductor learns to skip, including the times it is right.
      //
      // Two cuts:
      //   1. Only PLATFORM_AGENTS — the ones whose output changes with the platform: the three
      //      developers, the unit/device test agents (test command, framework, report name are
      //      per platform) and bk-debugger (build/test commands, log locations). Reviewers and
      //      auditors get their platform checklist baked in at build time
      //      (agents/_platform-sections/), and git/docs/PM agents are platform-agnostic.
      //   2. Only when `platform` above is still 'unknown'. When it resolved — BK_PLATFORM,
      //      workflow state's `platform`, or platform-context.json — subagent-init writes
      //      "- Platform: <platform>" into every subagent's context at SubagentStart, so a
      //      prompt that omits it loses nothing. Warning then is noise by construction.
      const PLATFORM_AGENTS = new Set([
        'bk-ios-developer', 'bk-android-developer', 'bk-flutter-developer',
        'bk-unit-test-agent', 'bk-device-test-agent', 'bk-debugger'
      ]);
      if (prompt && platform === 'unknown' && PLATFORM_AGENTS.has(agentType)
        && !/platform/i.test(prompt)) {
        warnings.push('missing_platform');
      }
      if (prompt && !/output/i.test(prompt)) warnings.push('missing_output_path');
      if (prompt && !/task[\s:]/i.test(prompt) && !/## Task/i.test(prompt)) {
        warnings.push('missing_task_section');
      }
      if (prompt && feature && !prompt.toLowerCase().includes(feature.toLowerCase())) {
        warnings.push('missing_feature_ref');
      }

      if (warnings.length > 0) {
        contextParts.push(`[DISPATCH-WARN] Prompt may be incomplete: ${warnings.join(', ')}`);
      }

      // --- Task 3.1A+B: Validate required/recommended sections, block if critical ---
      if (prompt) {
        const validation = validateDispatchPrompt(prompt);
        if (!validation.valid && validation.missing.length > 1) {
          // More than 1 required section missing → block dispatch (exit 2)
          process.stderr.write(
            `[DELEGATION-ENFORCER] BLOCKED: ${validation.message}\n`
          );
          // Track block metric so we can tune thresholds before tightening further.
          try {
            const { trackViolation } = require('./lib/harness-policy-loader.cjs');
            trackViolation({
              hook: 'delegation-enforcer',
              violation_type: 'blocked_by_missing_sections',
              tool: 'Task',
              target: agentType || 'unknown',
              blocked: true,
              severity: 'error',
              context: { missing: validation.missing, missingRecommended: validation.missingRecommended }
            });
          } catch { /* fail-open on telemetry */ }
          timer.end({ status: 'blocked', exit: 2 });
          process.exit(2);
        } else if (!validation.valid) {
          // Exactly 1 required section missing → advisory warning
          contextParts.push(`[DISPATCH-WARN] ${validation.message}`);
        }
        if (validation.missingRecommended.length > 0) {
          contextParts.push(`[DISPATCH-ADVISORY] Recommended sections missing: ${validation.missingRecommended.join(', ')}. Consider adding Platform: and Files: sections.`);
        }
      }

      // --- Task 3.1C: Check file ownership conflicts for parallel dispatches ---
      // SCHEMA NOTE (P1-2): Claude Code does NOT send a parallel_prompts array — parallel
      // Task spawns arrive as separate PreToolUse events. Accessor handles both legacy
      // (parallel_prompts) and tool_calls shapes; cross-event detection is parallel-lock-registry.
      const { getParallelBatch } = require('./lib/hook-event-accessor.cjs');
      const parallelBatch = getParallelBatch(data);
      if (parallelBatch) {
        const ownershipResult = checkFileOwnership(parallelBatch);
        if (ownershipResult.hasConflicts) {
          const conflictDesc = ownershipResult.conflicts
            .map(c => `"${c.file}" claimed by agents [${c.agents.join(', ')}]`)
            .join('; ');
          process.stderr.write(
            `[DELEGATION-ENFORCER] BLOCKED: File ownership conflict — ${conflictDesc}\n`
          );
          timer.end({ status: 'blocked-conflict', exit: 2 });
          process.exit(2);
        }
      }

      // --- Signal-aware retry detection ---
      if (state && state.signal_count >= 2 && state.retry_agents && agentType) {
        const sameAgentRetries = state.retry_agents.filter(a => a === agentType).length;
        if (sameAgentRetries >= 2) {
          const SIGNAL_HELPERS = {
            'agent_stuck': 'bk-brainstormer',
            'fix_loop_stuck': 'bk-problem-solving',
            'confidence_low': 'bk-sequential-thinking',
            'conflicting_results': 'bk-sequential-thinking',
            'unknown_api': 'bk-docs-seeker',
            'architecture_concern': 'bk-brainstormer',
            'performance_issue': 'bk-brainstormer'
          };
          const sigType = state.last_signal ? state.last_signal.type : 'agent_stuck';
          const helper = SIGNAL_HELPERS[sigType] || 'bk-brainstormer';
          contextParts.push(`[REACTIVE-WARN] Agent "${agentType}" has failed ${sameAgentRetries}x with signals. MUST dispatch ${helper} instead. Do NOT retry same agent — see conductor-role.md §5B.`);
        }
      }

      // Inject platform context — only on first dispatch per session (dedup)
      // subagent-init already provides platform + rules to each agent
      const platformInjectedKey = `BK_PLATFORM_CTX_INJECTED_${process.ppid || ''}`;
      const alreadyInjected = process.env[platformInjectedKey] === '1';

      if (!alreadyInjected && platformCtx) {
        if (platformCtx.architecture_pattern) contextParts.push(`[ARCH] Pattern: ${platformCtx.architecture_pattern}`);
        if (platformCtx.di_pattern) contextParts.push(`[ARCH] DI: ${platformCtx.di_pattern}`);
        if (platformCtx.async_pattern) contextParts.push(`[ARCH] Async: ${platformCtx.async_pattern}`);
        if (platformCtx.min_os_version) contextParts.push(`[ARCH] Min OS: ${platformCtx.min_os_version}`);
        if (platformCtx.state_management) contextParts.push(`[ARCH] State: ${platformCtx.state_management}`);

        if (platformCtx.commands) {
          const cmds = Object.entries(platformCtx.commands)
            .filter(([k, v]) => v != null && !k.endsWith('Note'))
            .map(([k, v]) => `${k}: ${v}`)
            .join(', ');
          if (cmds) contextParts.push(`[CMD] ${cmds}`);
        }

        // Mark as injected for this session via env file
        const envFile = process.env.CLAUDE_ENV_FILE;
        if (envFile) {
          try {
            const fs = require('fs');
            fs.appendFileSync(envFile, `${platformInjectedKey}=1\n`);
          } catch { /* best-effort */ }
        }
      }

      if (state && state.complexity_tier) {
        contextParts.push(`Tier: ${state.complexity_tier}`);
      }

      // Agent telemetry: start trace
      try {
        const { traceAgent } = require('./lib/agent-telemetry.cjs');
        traceAgent('start', { agent: agentType, feature: feature || undefined, platform, phase: phase || undefined });
      } catch { /* telemetry is best-effort */ }

      emitAdvisory(contextParts.join('. '), data);

      timer.end({ status: 'ok', exit: 0 });
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
    try { const {appendJsonl: _ra} = require('./lib/jsonl-rotator.cjs'); _ra(p.join(logDir, 'hook-log.jsonl'), JSON.stringify({ ts: new Date().toISOString(), hook: 'delegation-enforcer', status: 'crash', error: e.message }) + '\n'); }
    catch(_e2) { fs.appendFileSync(p.join(logDir, 'hook-log.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), hook: 'delegation-enforcer', status: 'crash', error: e.message }) + '\n'); }
  } catch (_) {}
  process.exit(0);
}
