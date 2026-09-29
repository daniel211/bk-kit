#!/usr/bin/env node
// agent-memory-path-guard.cjs — Block agent memory writes outside canonical roots.
// Trigger: PreToolUse (Write|Edit|Bash)
// Bash: a creating command (mkdir/touch/cp/mv/tee/ln/install/redirect) aimed at a wrong-root
// agent-memory path is denied too — a blocked Write leaves no file, but a prior `mkdir -p`
// leaves the stray `.claude/agent-memory/<agent>/` directory behind.

'use strict';

try {
  const path = require('path');
  const os = require('os');
  const { createHookTimer } = require('./lib/hook-logger.cjs');
  const { isHookEnabled } = require('./lib/bk-config-utils.cjs');
  const { resolveProjectRoot } = require('./lib/resolve-project-root.cjs');
  const { getToolName, getFilePath, getCwd } = require('./lib/hook-event-accessor.cjs');
  const { trackViolation } = require('./lib/harness-policy-loader.cjs');

  function isInside(candidate, root) {
    const relative = path.relative(root, candidate);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  }

  // A memory dir is only ever `.claude/agent-memory[-local]/`. Requiring the `.claude`
  // parent keeps unrelated folders that merely share the name (docs/agent-memory/)
  // out of this hook's business.
  function memoryKind(filePath) {
    const segments = String(filePath).replace(/\\/g, '/').split('/').filter(Boolean);
    for (let i = 0; i < segments.length - 1; i++) {
      if (segments[i] !== '.claude') continue;
      if (segments[i + 1] === 'agent-memory-local') return 'local';
      if (segments[i + 1] === 'agent-memory') return 'project-or-user';
    }
    return null;
  }

  // ── Bash support ──────────────────────────────────────────────────────────────
  const CREATING_CMD = /(^|[\s;&|(])(mkdir|touch|cp|mv|tee|ln|install|rsync)\s|>{1,2}\s*\S*\.claude\/agent-memory/;

  function stripQuotes(tok) { return tok.replace(/^['"]|['"]$/g, ''); }

  /**
   * Memory paths a Bash command would create, resolved against the cwd as `cd` moves it.
   * Best-effort: `$VAR` / `~` prefixed tokens are only checked when they can be resolved.
   * @returns {Array<{raw: string, candidate: string}>}
   */
  function bashMemoryTargets(command, startCwd) {
    const found = [];
    let cwd = startCwd;
    for (const segment of String(command).split(/&&|\|\||;|\n/)) {
      const tokens = segment.match(/"[^"]*"|'[^']*'|[^\s>|]+/g) || [];
      if (tokens[0] === 'cd' && tokens[1]) {
        const dir = stripQuotes(tokens[1]);
        if (!/[$`]/.test(dir)) cwd = path.resolve(cwd, dir.replace(/^~(?=\/|$)/, os.homedir()));
        continue;
      }
      if (!CREATING_CMD.test(` ${segment}`)) continue;
      for (const tok of tokens) {
        const raw = stripQuotes(tok);
        if (!memoryKind(raw)) continue;
        if (/[$`]/.test(raw.split('.claude')[0])) continue; // unresolvable variable prefix
        const expanded = raw.replace(/^~(?=\/|$)/, os.homedir());
        found.push({ raw, candidate: path.resolve(cwd, expanded) });
      }
    }
    return found;
  }

  function enforceBash(data, timer, toolName) {
    try {
      const command = String((data.tool_input || {}).command || '');
      if (!command.includes('.claude/agent-memory')) {
        timer.end({ status: 'not_memory', exit: 0 });
        process.exit(0);
      }
      const projectRoot = path.resolve(resolveProjectRoot(data));
      const eventCwd = getCwd(data) || process.cwd();
      for (const { raw, candidate } of bashMemoryTargets(command, eventCwd)) {
        const kind = memoryKind(candidate);
        const projectMemoryRoot = path.join(projectRoot, '.claude', 'agent-memory');
        const localMemoryRoot = path.join(projectRoot, '.claude', 'agent-memory-local');
        const userMemoryRoot = path.join(os.homedir(), '.claude', 'agent-memory');
        const allowedRoots = kind === 'local' ? [localMemoryRoot] : [projectMemoryRoot, userMemoryRoot];
        if (allowedRoots.some((root) => isInside(candidate, root))) continue;
        const reason =
          `Bash would create an agent memory path outside its canonical root: ${candidate}. ` +
          `Use the absolute project-root path under ${allowedRoots.join(' or ')}; ` +
          'never mkdir .claude/agent-memory relative to a code, worktree, bk/dev, or feature directory.';
        process.stderr.write(`[AGENT MEMORY PATH BLOCK] ${reason}\n`);
        trackViolation({
          hook: 'agent-memory-path-guard',
          violation_type: 'agent_memory_wrong_root',
          tool: toolName,
          target: raw,
          blocked: true,
          severity: 'error',
          context: { candidate, project_root: projectRoot, via: 'bash' }
        });
        timer.end({ status: 'blocked', path: candidate, exit: 2 });
        process.exit(2);
      }
      timer.end({ status: 'allowed', exit: 0 });
      process.exit(0);
    } catch (err) {
      // Reached only after the command text named a memory path, so fail closed like Write|Edit.
      if (err && err.bkDispatchExit) throw err;
      process.stderr.write(`[AGENT MEMORY PATH BLOCK] Internal error: ${err.message}\n`);
      timer.end({ status: 'error', error: err.message, exit: 2 });
      process.exit(2);
    }
  }

  async function main() {
    const timer = createHookTimer('agent-memory-path-guard');
    let data = {};
    let toolName = '';
    let filePath = '';
    let kind = null;
    let bashMemoryCommand = false;

    // Phase 1 — classification. Fails OPEN. This hook sees every Write|Edit, so until
    // a memory path is positively identified it must not block anything.
    try {
      if (!isHookEnabled('agent-memory-path-guard')) {
        timer.end({ status: 'skipped', exit: 0 });
        process.exit(0);
      }

      let raw = '';
      for await (const chunk of process.stdin) raw += chunk;
      data = JSON.parse(raw || '{}');
      toolName = getToolName(data);

      if (toolName === 'Bash') {
        if (!String((data.tool_input || {}).command || '').includes('.claude/agent-memory')) {
          timer.end({ status: 'not_memory', exit: 0 });
          process.exit(0);
        }
        bashMemoryCommand = true; // enforced after this try — its exit must not hit the catch below
      } else {

      // Write and Edit are the only other tools that touch memory files; no MultiEdit exists.
      if (toolName !== 'Write' && toolName !== 'Edit') {
        timer.end({ status: 'irrelevant_tool', exit: 0 });
        process.exit(0);
      }

      filePath = getFilePath(data);
      kind = memoryKind(filePath);
      if (!filePath || !kind) {
        timer.end({ status: 'not_memory', exit: 0 });
        process.exit(0);
      }
      }
    } catch (err) {
      // Never established that this was a memory write, so stay out of the way rather
      // than blocking an unrelated source edit.
      process.stderr.write(`[agent-memory-path-guard] skipped: ${err.message}\n`);
      timer.end({ status: 'classify_error', error: err.message, exit: 0 });
      process.exit(0);
    }

    if (bashMemoryCommand) return enforceBash(data, timer, toolName);

    // Phase 2 — enforcement. Fails CLOSED. This is known to be a memory write, so a
    // crash here must not let a wrong-root write through.
    try {
      const projectRoot = path.resolve(resolveProjectRoot(data));
      const eventCwd = getCwd(data) || process.cwd();
      const candidate = path.resolve(eventCwd, filePath);
      const projectMemoryRoot = path.join(projectRoot, '.claude', 'agent-memory');
      const localMemoryRoot = path.join(projectRoot, '.claude', 'agent-memory-local');
      const userMemoryRoot = path.join(os.homedir(), '.claude', 'agent-memory');
      const allowedRoots = kind === 'local'
        ? [localMemoryRoot]
        : [projectMemoryRoot, userMemoryRoot];

      if (allowedRoots.some((root) => isInside(candidate, root))) {
        timer.end({ status: 'allowed', path: candidate, exit: 0 });
        process.exit(0);
      }

      // The event carries no memory scope, so name every root this write could
      // legitimately target instead of misdirecting a user-scoped agent.
      const expectedRoot = kind === 'local' ? localMemoryRoot : projectMemoryRoot;
      const reason =
        `Agent memory path resolves outside its canonical root: ${candidate}. ` +
        `Use the system-provided memory directory under ${allowedRoots.join(' or ')}; ` +
        'never construct .claude/agent-memory relative to a code, worktree, bk/dev, or feature directory.';

      process.stderr.write(`[AGENT MEMORY PATH BLOCK] ${reason}\n`);
      trackViolation({
        hook: 'agent-memory-path-guard',
        violation_type: 'agent_memory_wrong_root',
        tool: toolName,
        target: filePath,
        blocked: true,
        severity: 'error',
        context: { candidate, project_root: projectRoot, expected_root: expectedRoot }
      });
      timer.end({ status: 'blocked', path: candidate, exit: 2 });
      process.exit(2);
    } catch (err) {
      process.stderr.write(`[AGENT MEMORY PATH BLOCK] Internal error: ${err.message}\n`);
      timer.end({ status: 'error', error: err.message, exit: 2 });
      process.exit(2);
    }
  }

  main();
} catch (_) {
  // Fail open when the hook installation itself is incomplete. Inside main(), only
  // confirmed memory writes fail closed; everything else fails open.
  process.exit(0);
}
