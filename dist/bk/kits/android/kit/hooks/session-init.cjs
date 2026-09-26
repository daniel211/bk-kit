#!/usr/bin/env node
// session-init.cjs - SessionStart hook for beer-kit mobile toolkit
// Template variables: android, platform-context.json, ./gradlew ktlintCheck detekt
// Trigger: SessionStart (startup|resume|clear|compact)
// Purpose: Detect mobile platform, load platform context, init workflow state

'use strict';

// Outer crash wrapper (catches require/parse failures)
try {
  const { createHookTimer } = require('./lib/hook-logger.cjs');
  const fs = require('fs');
  const path = require('path');
  const { resolveProjectRoot } = require('./lib/resolve-project-root.cjs');
  const { isHookEnabled, readPlatformContext, readWorkflowState, writeWorkflowState, writeEnv } = require('./lib/bk-config-utils.cjs');
  const { detectMobilePlatform, detectProjectType, detectPackageManager, getGitBranch } = require('./lib/project-detector.cjs');
  const { hasFoundationDocs, FOUNDATION_REL } = require('./lib/foundation-docs.cjs');

  async function main() {
    const timer = createHookTimer('session-init');
    try {
      if (!isHookEnabled('session-init')) {
        timer.end({ status: 'skipped', exit: 0 });
        process.exit(0);
      }

      let input = '';
      for await (const chunk of process.stdin) input += chunk;
      const data = JSON.parse(input || '{}');
      const source = data.source || 'unknown';

      // Use template-specified platform or auto-detect
      const templatePlatform = 'android';
      const platform = (templatePlatform && !templatePlatform.startsWith('{{') && templatePlatform !== 'auto')
        ? templatePlatform
        : detectMobilePlatform();

      const projectType = detectProjectType();
      const pm = detectPackageManager();
      const branch = getGitBranch();

      // Load platform context — first try template-specified path, then auto
      let platformCtx = null;
      const configPath = 'platform-context.json';
      if (configPath) {
        try {
          const absConfig = path.isAbsolute(configPath)
            ? configPath
            : path.join(resolveProjectRoot(), configPath);
          if (fs.existsSync(absConfig)) {
            platformCtx = JSON.parse(fs.readFileSync(absConfig, 'utf8'));
          }
        } catch { /* fall through to auto */ }
      }
      if (!platformCtx) platformCtx = readPlatformContext();

      // Init workflow state if missing
      const { resolveWorkflowId } = require('./lib/workflow-identity.cjs');
      const existing = readWorkflowState();
      if (!existing) {
        writeWorkflowState({
          command: null,
          feature: null,
          // Stamped so state names its workflow from the start. The cost tally does NOT
          // key off this field — the conductor writes workflowId too, so it cannot tell
          // whether the tally was reset; subagent-cost-capture keeps its own owner key
          // (cumulativeCostWorkflowId) beside cumulativeCostUsd and resets on that.
          // Deliberately NOT resetting cumulativeCostUsd here: this hook also runs on
          // `resume` and `compact`, and zeroing there would wipe the budget on every
          // compaction.
          workflowId: resolveWorkflowId(null, data.session_id || data.sessionId || null),
          current_phase: null,
          platform,
          skills_loaded: [],
          background_tasks: [],
          phase_history: [],
          quality_fix_count: 0
        });
      } else {
        const patch = {};
        if (!existing.platform) patch.platform = platform;
        // Migration for state written before workflowId existed.
        if (!existing.workflowId) {
          patch.workflowId = resolveWorkflowId(existing, data.session_id || data.sessionId || null);
        }
        if (Object.keys(patch).length) writeWorkflowState(patch);
      }

      const state = readWorkflowState();

      // Detect foundation, active plan, LSP
      const cwd = resolveProjectRoot();

      // Close out subagents left open by a previous session. A spawn whose SubagentStop
      // never fired (interrupted agent, killed CLI) can never stop now, and an unreaped one
      // was still rendering as `🤖 bk-git-manager(8100s)` two hours later while skewing
      // every cost rollup. SessionStart is the one moment where "left over from before" is
      // unambiguous. Wrapped: a reaper failure must never break session start.
      try {
        const { reapOrphanedSubagents } = require('./lib/subagent-live-reaper.cjs');
        reapOrphanedSubagents(cwd);
      } catch { /* fail-open — reaping is housekeeping, not a precondition */ }

      // Same bug class, other file: a lint queue is opened on PostToolUse and drained at
      // Stop, so a session that dies first leaves its .bk-metrics/lint-queue/<id>.jsonl
      // behind with nothing anywhere to clean it up (fusionworkomni still held one two days
      // after that session ended).
      //
      // ADOPT BEFORE REAPING. That orphan queue names real files that were never linted, so
      // deleting it threw away the lint pass rather than performing it — which is the whole
      // #4 failure: Stop never fired, and 24 hours later the evidence was removed. Adoption
      // spawns a detached worker per orphan queue; only what survives that (too old, or
      // nothing left in it) is reaped. Both calls get the current session id so this
      // session's own queue — and its --native sibling — is neither adopted nor swept out
      // from under it; it is drained by its own Stop and by lint-findings-inject.
      const lintSessionId = data.session_id || data.sessionId || null;
      try {
        const { adoptOrphanLintQueues } = require('./lib/lint-worker-spawn.cjs');
        adoptOrphanLintQueues(cwd, {
          currentSessionId: lintSessionId,
          platform,
          lintCommand: './gradlew ktlintCheck detekt'
        });
      } catch { /* fail-open — adoption is recovery, not a precondition */ }
      try {
        const { reapStaleQueues } = require('./lib/lint-queue.cjs');
        reapStaleQueues(cwd, { currentSessionId: lintSessionId });
      } catch { /* fail-open — reaping is housekeeping, not a precondition */ }

      // bk/docs/foundation/, where /bk-bootstrap writes — not <root>/docs/foundation/, which
      // made every session in a bootstrapped repo report "Foundation: no" (lib/foundation-docs.cjs).
      const hasFoundation = hasFoundationDocs(cwd);
      const hasLSP = process.env.ENABLE_LSP_TOOL === '1';

      // Scan bk/dev/ for active plan (.plan-state.json with status != complete)
      let activePlan = '';
      let activePlanFeature = '';
      try {
        const plansDir = path.join(cwd, 'bk', 'dev');
        if (fs.existsSync(plansDir)) {
          const entries = fs.readdirSync(plansDir, { withFileTypes: true });
          for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const stateFile = path.join(plansDir, entry.name, '.plan-state.json');
            if (!fs.existsSync(stateFile)) continue;
            try {
              const planState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
              if (planState.status !== 'complete') {
                activePlan = path.join('bk', 'dev', entry.name);
                activePlanFeature = planState.feature || entry.name;
                break;
              }
            } catch { /* skip malformed state */ }
          }
        }
      } catch { /* plan scan is best-effort */ }

      // Write BK_* env vars for subagent propagation
      const envFile = process.env.CLAUDE_ENV_FILE;
      if (envFile) {
        writeEnv(envFile, 'BK_PLATFORM', platform);
        writeEnv(envFile, 'BK_PROJECT_TYPE', projectType || '');
        writeEnv(envFile, 'BK_GIT_BRANCH', branch || '');
        writeEnv(envFile, 'BK_PROJECT_ROOT', cwd);
        writeEnv(envFile, 'BK_REPORTS_PATH', path.join(cwd, 'bk', 'dev', 'reports'));
        writeEnv(envFile, 'BK_HAS_FOUNDATION', hasFoundation ? 'true' : 'false');
        writeEnv(envFile, 'BK_ACTIVE_PLAN', activePlan);
        writeEnv(envFile, 'BK_ACTIVE_PLAN_FEATURE', activePlanFeature);
        writeEnv(envFile, 'BK_LSP_AVAILABLE', hasLSP ? 'true' : 'false');
        if (state && state.command) writeEnv(envFile, 'BK_WORKFLOW_COMMAND', state.command);
        if (state && state.current_phase) writeEnv(envFile, 'BK_WORKFLOW_PHASE', state.current_phase);
      }

      // Build session output
      const parts = [`Session: ${source}`, `Platform: ${platform}`];
      if (projectType) parts.push(`Project: ${projectType}`);
      if (pm) parts.push(`PM: ${pm}`);
      if (branch) parts.push(`Branch: ${branch}`);

      if (platformCtx) {
        if (platformCtx.architecture_pattern) parts.push(`Arch: ${platformCtx.architecture_pattern}`);
        if (platformCtx.min_os_version) parts.push(`Min OS: ${platformCtx.min_os_version}`);
      }

      parts.push(`Foundation: ${hasFoundation ? 'yes' : 'no'}`);
      parts.push(`LSP: ${hasLSP ? 'yes' : 'no'}`);
      if (activePlan) parts.push(`Plan: ${activePlanFeature}`);

      if (state && state.current_phase) {
        parts.push(`Workflow: ${state.command || '?'} / ${state.current_phase}`);
      }

      console.log(parts.join(' | '));

      // Session Health Check Summary
      const healthChecks = [];

      // 1. Platform detection
      const detectedPlatform = process.env.BK_PLATFORM || platform || 'unknown';
      healthChecks.push(detectedPlatform !== 'unknown' 
        ? `✅ Platform: ${detectedPlatform}` 
        : '⚠️  Platform: not detected');

      // 2. Foundation docs — same answer as the `Foundation:` line above, by construction
      healthChecks.push(hasFoundation
        ? `✅ Foundation docs: ${FOUNDATION_REL}/`
        : '⚠️  Foundation docs: not found (run /bk-bootstrap)');

      // 3. Active plan
      const plansHealthPath = path.join(cwd, 'bk', 'dev');
      const hasActivePlanHealth = fs.existsSync(plansHealthPath) && 
        fs.readdirSync(plansHealthPath).some(f => !f.startsWith('.') && !f.startsWith('shared'));
      healthChecks.push(hasActivePlanHealth 
        ? '✅ Active plan: found' 
        : 'ℹ️  Active plan: none (run /bk-plan to start)');

      // 4. MCP availability
      const mcpServers = process.env.BK_MCP_SERVERS || '';
      if (mcpServers) {
        healthChecks.push(`✅ MCP: ${mcpServers}`);
      } else {
        healthChecks.push('ℹ️  MCP: none configured');
      }

      // 5. Workflow state
      const statePath = path.join(cwd, 'bk', 'dev', 'shared', '.workflow-state.json');
      if (fs.existsSync(statePath)) {
        try {
          const stateData = JSON.parse(fs.readFileSync(statePath, 'utf8'));
          healthChecks.push(`✅ Workflow state: ${stateData.current_phase || 'idle'} (${stateData.command || 'none'})`);
        } catch (e) {
          healthChecks.push('⚠️  Workflow state: corrupt (reset recommended)');
        }
      } else {
        healthChecks.push('ℹ️  Workflow state: clean');
      }

      // Output health check
      const summary = '\n--- Beer Kit Session Health Check ---\n' + healthChecks.join('\n') + '\n---\n';
      process.stdout.write(summary);

      if (source === 'compact') {
        try {
          const { readLatestCheckpoint } = require('./lib/bk-config-utils.cjs');
          const checkpoint = readLatestCheckpoint();
          if (checkpoint && checkpoint.workflow) {
            const currentState = readWorkflowState();
            const isStale = !currentState || !currentState.current_phase;
            if (isStale && checkpoint.workflow.current_phase) {
              writeWorkflowState(checkpoint.workflow);
              console.log(`[CHECKPOINT] Restored from ${checkpoint.timestamp}`);
            }
          }
        } catch { /* checkpoint restore is best-effort */ }

        console.log('\n[!] CONTEXT COMPACTED: Verify approval state before continuing.');
        console.log('    Read bk/dev/shared/.workflow-state.json to restore context.');
      }

      timer.end({ status: 'ok', exit: 0 });
      process.exit(0);
    } catch (err) {
      timer.end({ status: 'error', error: err.message, exit: 0 });
      process.stderr.write(`[session-init] error: ${err.message}\n`);
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
      JSON.stringify({ ts: new Date().toISOString(), hook: 'session-init', status: 'crash', error: e.message }) + '\n');
  } catch (_) {}
  process.exit(0);
}
