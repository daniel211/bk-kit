#!/usr/bin/env node
/**
 * SubagentStart Hook - Injects team context for Agent Team teammates
 *
 * Fires: When a subagent is started (SubagentStart event)
 * Purpose: If the spawned agent is a team member, inject peer info + task summary
 * Design: Non-blocking, fail-open (exit 0 always), no external deps
 */

// Crash wrapper
try {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  const { isHookEnabled } = require('./lib/bk-config-utils.cjs');

  if (!isHookEnabled('team-context-inject')) {
    process.exit(0);
  }

const TEAMS_DIR = path.join(os.homedir(), '.claude', 'teams');
const TASKS_DIR = path.join(os.homedir(), '.claude', 'tasks');

/**
 * Extract team name from agent_id (format: "name@team-name")
 * Returns null if not a team agent or if name contains path separators
 */
function extractTeamName(agentId) {
  if (!agentId || typeof agentId !== 'string') return null;
  const atIdx = agentId.indexOf('@');
  if (atIdx < 1) return null;
  const name = agentId.substring(atIdx + 1);
  // Reject path traversal attempts
  if (name.includes('/') || name.includes('\\') || name.includes('..')) return null;
  return name;
}

/**
 * Read and parse JSON file safely
 */
function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Build peer list from team config, excluding the current agent
 */
function buildPeerList(config, currentAgentId) {
  if (!config?.members?.length) return '';
  const peers = config.members
    .filter(m => m.agentId !== currentAgentId)
    .map(m => `${m.name} (${m.agentType})`)
    .join(', ');
  return peers || 'none';
}

/**
 * Build CK stack context from environment variables
 * Set by session-init.cjs, available to subagents via SubagentStart
 */
function buildMkContext() {
  const ctx = [];
  const env = process.env;

  if (env.BK_REPORTS_PATH) ctx.push(`Reports: ${env.BK_REPORTS_PATH}`);
  if (env.BK_PLANS_PATH) ctx.push(`Plans: ${env.BK_PLANS_PATH}`);
  if (env.BK_PROJECT_ROOT) ctx.push(`Project: ${env.BK_PROJECT_ROOT}`);
  if (env.BK_NAME_PATTERN) ctx.push(`Naming: ${env.BK_NAME_PATTERN}`);
  if (env.BK_GIT_BRANCH) ctx.push(`Branch: ${env.BK_GIT_BRANCH}`);
  if (env.BK_ACTIVE_PLAN) ctx.push(`Active plan: ${env.BK_ACTIVE_PLAN}`);
  ctx.push('Commits: conventional (feat:, fix:, docs:, refactor:, test:, chore:)');

  return ctx;
}

/**
 * Summarize tasks from team task directory
 */
function summarizeTasks(teamName) {
  const taskDir = path.join(TASKS_DIR, teamName);
  try {
    if (!fs.existsSync(taskDir)) return null;
    const files = fs.readdirSync(taskDir).filter(f => f.endsWith('.json'));
    let pending = 0, inProgress = 0, completed = 0;
    for (const file of files) {
      const task = readJson(path.join(taskDir, file));
      if (!task?.status) continue;
      if (task.status === 'pending') pending++;
      else if (task.status === 'in_progress') inProgress++;
      else if (task.status === 'completed') completed++;
    }
    return { pending, inProgress, completed, total: files.length };
  } catch {
    return null;
  }
}

/**
 * Main hook execution
 */
function main() {
  try {
    const stdin = fs.readFileSync(0, 'utf-8').trim();
    if (!stdin) process.exit(0);

    const payload = JSON.parse(stdin);
    const agentId = payload.agent_id || '';

    // Detect team membership from agent_id pattern (name@team-name)
    const teamName = extractTeamName(agentId);
    if (!teamName) process.exit(0); // Not a team agent, exit silently

    // Read team config
    const configPath = path.join(TEAMS_DIR, teamName, 'config.json');
    const config = readJson(configPath);
    if (!config) process.exit(0); // No team config found

    // Build context
    const peerList = buildPeerList(config, agentId);
    const tasks = summarizeTasks(teamName);

    const lines = [];
    lines.push(`## Team Context`);
    lines.push(`Team: ${config.name || teamName}`);
    lines.push(`Your peers: ${peerList}`);

    if (tasks) {
      lines.push(`Task summary: ${tasks.pending} pending, ${tasks.inProgress} in progress, ${tasks.completed} completed`);
    }

    // CK stack context
    const ckCtx = buildMkContext();
    if (ckCtx.length > 1) { // >1 = has env vars beyond the always-present commit convention line
      lines.push('');
      lines.push('## MK Context');
      lines.push(...ckCtx);
    }

    lines.push('');
    lines.push('Remember: Check TaskList, claim tasks, respect file ownership, use SendMessage to communicate.');

    const output = {
      hookSpecificOutput: {
        hookEventName: "SubagentStart",
        additionalContext: lines.join('\n')
      }
    };

    console.log(JSON.stringify(output));
    process.exit(0);
  } catch (error) {
    // Fail-open: log to stderr, exit cleanly
    if (process.env.BK_DEBUG) {
      console.error(`[team-context-inject] Error: ${error.message}`);
    }
    process.exit(0);
  }
  }

  main();
} catch (e) {
  // Minimal crash logging (zero deps — only Node builtins)
  // A DispatchExit is this hook's own process.exit() unwinding under bk-dispatch, not a
  // crash. Logging it here is how a clean run got filed as `status: "crash"`.
  if (e && e.bkDispatchExit) throw e;

  try {
    const fs = require('fs');
    const p = require('path');
    const logDir = p.join(__dirname, '.logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    try { const {appendJsonl: _ra} = require('./lib/jsonl-rotator.cjs'); _ra(p.join(logDir, 'hook-log.jsonl'), JSON.stringify({ ts: new Date().toISOString(), hook: p.basename(__filename, '.cjs'), status: 'crash', error: e.message }) + '\n'); }
    catch(_e2) { fs.appendFileSync(p.join(logDir, 'hook-log.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), hook: p.basename(__filename, '.cjs'), status: 'crash', error: e.message }) + '\n'); }
  } catch (_) {}
  process.exit(0); // fail-open
}
