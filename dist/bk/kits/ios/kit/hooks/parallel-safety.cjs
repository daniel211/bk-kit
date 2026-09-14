#!/usr/bin/env node
'use strict';

/**
 * Parallel Execution Safety Hook
 * Trigger: PreToolCall (Task)
 * Purpose: Prevent file ownership conflicts when dispatching parallel agents
 *
 * Reads dispatch prompts and checks for overlapping file targets.
 * Blocks dispatch if two agents would edit the same file.
 */

// Outer crash wrapper (catches require/parse failures)
try {
  const { createHookTimer } = require('./lib/hook-logger.cjs');
  const fs = require('fs');
  const path = require('path');
  // P1-1: Lock state lives in.bk-metrics/parallel-locks/ via central registry.
  // Releases happen via task-completed-handler (SubagentStop) — no longer rely on TTL alone.
  const lockRegistry = require('./lib/parallel-lock-registry.cjs');

  /**
   * Determine if an agent is read-only.
   * Priority: 1) Mode: field in dispatch prompt  2) agent definition frontmatter (disallowedTools contains Edit)
   */
  function isReadOnly(agentType, prompt) {
    // 1. Explicit Mode: in dispatch prompt (highest priority)
    const modeMatch = prompt && prompt.match(/^Mode:[ \t]*(\S+)/im);
    if (modeMatch) {
      const mode = modeMatch[1].toLowerCase();
      if (['read', 'review', 'audit', 'analyze', 'inspect'].includes(mode)) return true;
      if (['write', 'edit', 'fix', 'implement', 'create'].includes(mode)) return false;
    }
    // 2. Read agent definition .md — if disallowedTools contains Edit, agent is read-only
    return agentHasEditDisallowed(agentType);
  }

  /**
   * Check agent .md frontmatter: disallowedTools contains Edit?
   * Searches agents/ directory relative to hooks/ (../agents/)
   */
  function agentHasEditDisallowed(agentType) {
    try {
      // Agent files are at ../<agents-dir>/<agentType>.md relative to hooks/
      const agentsDir = path.join(__dirname, '..', 'agents');
      const agentFile = path.join(agentsDir, `${agentType}.md`);
      if (!fs.existsSync(agentFile)) return false; // unknown agent → assume write (safer)
      const content = fs.readFileSync(agentFile, 'utf8');
      // Parse frontmatter: look for disallowedTools line
      const match = content.match(/^disallowedTools:\s*\[([^\]]+)\]/m);
      if (!match) return false; // no disallowedTools → has all tools → write
      const disallowed = match[1].split(',').map(t => t.trim());
      return disallowed.includes('Edit');
    } catch (_) {
      return false; // on error, assume write (safer — will create lock)
    }
  }

  /**
   * Extract file paths from a dispatch prompt.
   * ONLY reads the explicit "Files:" section — no fuzzy fallback.
   * Each entry is validated: must look like a real file path (contains / and extension).
   */
  function extractFileTargets(prompt) {
    const files = new Set();

    // Only match "Files:" section (not "line:", "description:", etc.)
    // Handles both inline (Files: a.kt, b.kt) and block (Files:\n  - a.kt\n  - b.kt)
    const sectionPattern = /^Files?:[ \t]*(.*)/gim;
    let match;
    while ((match = sectionPattern.exec(prompt)) !== null) {
      // Parse same-line content (may be empty for block format)
      if (match[1].trim()) {
        parseFileEntries(match[1], files);
      }

      // Collect continuation lines (indented, starting with -, or bare paths)
      const rest = prompt.slice(match.index + match[0].length);
      const contLines = rest.split('\n');
      for (const line of contLines) {
        const trimmed = line.trim();
        if (!trimmed) continue; // skip blank lines
        if (/^\s*[-•]\s/.test(line)) {
          // Bullet line: "  - path/to/file.kt"
          parseFileEntries(trimmed.replace(/^[-•]\s*/, ''), files);
        } else if (/^\s+\S+\//.test(line)) {
          // Indented path: "  path/to/file.kt"
          parseFileEntries(trimmed, files);
        } else if (/^\/|^\w+\//.test(trimmed) && !/:/.test(trimmed)) {
          // Non-indented bare path (no colon = not a new section header)
          parseFileEntries(trimmed, files);
        } else {
          break; // New section or unrelated content
        }
      }
    }

    return [...files];
  }

  /**
   * Parse comma-separated file entries, validating each looks like a real path.
   * Must contain / and a file extension (1-6 chars), or be a directory path ending in /.
   */
  function parseFileEntries(text, files) {
    const candidates = text.split(',').map(f => f.trim()).filter(Boolean);
    for (const candidate of candidates) {
      // Must contain / (path separator) and look like a file path
      // e.g. "src/hooks/foo.cjs" or "app/src/main/java/Foo.kt"
      if (candidate.includes('/') && /\.\w{1,6}$/.test(candidate)) {
        files.add(candidate);
      } else if (candidate.includes('/') && candidate.endsWith('/')) {
        files.add(candidate); // directory target
      }
    }
  }

  // Lock read/write delegated directly to lib/parallel-lock-registry (P1-1).

  async function main() {
    const timer = createHookTimer('parallel-safety');
    try {
      const { isHookEnabled } = require('./lib/bk-config-utils.cjs');

      if (!isHookEnabled('parallel-safety')) {
        timer.end({ status: 'skipped', exit: 0 });
        process.exit(0);
      }

      let input = '';
      for await (const chunk of process.stdin) input += chunk;
      const data = JSON.parse(input || '{}');

      const toolInput = data.tool_input || {};
      const prompt = toolInput.prompt || '';
      const agentType = toolInput.subagent_type || toolInput.agent_type || 'unknown';

      if (!prompt) {
        timer.end({ status: 'no_prompt', exit: 0 });
        process.exit(0);
      }

      // Extract file targets from the dispatch prompt
      const fileTargets = extractFileTargets(prompt);

      if (fileTargets.length === 0) {
        // No file targets detected — warn if prompt lacks Files: section
        if (prompt && !/Files?:/i.test(prompt)) {
          process.stdout.write(JSON.stringify({
            additionalContext: '[PARALLEL-SAFETY] No Files: section in dispatch prompt. Add "Files: path/to/file.ext" for parallel safety locks.'
          }) + '\n');
        }
        timer.end({ status: 'no_files', exit: 0 });
        process.exit(0);
      }

      // Determine if the current agent is read-only
      const currentIsReadOnly = isReadOnly(agentType, prompt);
      const currentMode = currentIsReadOnly ? 'read' : 'write';

      // Check against existing locks
      const activeLocks = lockRegistry.readActiveLocks();
      const conflicts = [];

      for (const file of fileTargets) {
        if (activeLocks[file]) {
          const existing = activeLocks[file];
          // Skip self-conflict: same agent type retrying
          if (existing.agent === agentType) continue;
          // Read + Read = OK (multiple readers allowed)
          // Only block when at least one side is a writer
          const existingMode = existing.mode || 'write'; // legacy locks default to write
          if (existingMode === 'read' && currentMode === 'read') continue;
          conflicts.push({
            file,
            existingAgent: existing.agent,
            existingMode,
            newAgent: agentType,
            newMode: currentMode
          });
        }
      }

      if (conflicts.length > 0) {
        const conflictDesc = conflicts
          .map(c => `"${c.file}" ${c.existingMode}-locked by ${c.existingAgent}, ${c.newAgent} wants ${c.newMode}`)
          .join('; ');
        process.stderr.write(
          `[PARALLEL-SAFETY] BLOCKED: File conflict — ${conflictDesc}. ` +
          `Agent "${agentType}" cannot proceed until the owning agent completes.\n`
        );
        process.stdout.write(
          `Parallel dispatch blocked: ${conflictDesc}. ` +
          `Wait for the owning agent to finish or use sequential dispatch.\n`
        );
        timer.end({ status: 'blocked', exit: 2 });
        process.exit(2);
      }

      // No conflicts — register locks for this agent's files
      for (const file of fileTargets) {
        lockRegistry.writeLock(file, agentType, currentMode);
      }

      process.stdout.write(JSON.stringify({
        additionalContext: `[PARALLEL-SAFETY] ${currentMode}-locks acquired for ${agentType}: ${fileTargets.join(', ')}`
      }) + '\n');

      timer.end({ status: 'ok', exit: 0 });
      process.exit(0);
    } catch (err) {
      timer.end({ status: 'error', error: err.message, exit: 0 });
      process.exit(0); // Fail-open to not break dispatch
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
    try { const {appendJsonl: _ra} = require('./lib/jsonl-rotator.cjs'); _ra(p.join(logDir, 'hook-log.jsonl'), JSON.stringify({ ts: new Date().toISOString(), hook: 'parallel-safety', status: 'crash', error: e.message }) + '\n'); }
    catch(_e2) { fs.appendFileSync(p.join(logDir, 'hook-log.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), hook: 'parallel-safety', status: 'crash', error: e.message }) + '\n'); }
  } catch (_) {}
  process.exit(0); // Fail-open
}
