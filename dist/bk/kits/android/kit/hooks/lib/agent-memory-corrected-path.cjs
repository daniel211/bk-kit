/**
 * agent-memory-corrected-path.cjs — Turn a wrong-root agent-memory path into the right one.
 *
 * agent-memory-path-guard used to say "use the system-provided directory" and leave the agent to
 * guess; in the field (X-Game-Pro, ~60 blocks) agents guessed the same wrong root again, so the
 * lesson was lost. The deny message now carries the exact absolute path to retry with.
 *
 * A wrong path always still contains `.claude/agent-memory[-local]/<agent>/<rest>`; the prefix
 * before it (a bk/dev feature dir, a package dir, `.claude/worktrees/agent-*`) is the mistake.
 * Keep `<agent>/<rest>` and re-root it under the canonical project root.
 *
 * Worktrees: the canonical root is the MAIN repo (a worktree's `.git` is a file pointing at
 * `<main>/.git/worktrees/<name>`), matching where Claude Code keys memory.
 *
 * NOTE: PreToolUse hooks in this kit only allow/deny (exit 0/2 + stderr). Nothing here rewrites
 * tool input; the agent has to retry with the path we print.
 */

'use strict';

const path = require('path');
const { canonicalProjectRoot } = require('./subagent-user-context.cjs');

/**
 * @param {string} candidate  Absolute path that was refused.
 * @param {string} projectRoot  Root the guard resolved (may itself be a worktree).
 * @returns {{ path: string, dir: string, agent: string|null }|null}  null when not a memory path.
 */
function correctedMemoryPath(candidate, projectRoot) {
  const parts = path.resolve(String(candidate)).split(path.sep);
  for (let i = 0; i < parts.length - 1; i++) {
    if (parts[i] !== '.claude') continue;
    const scope = parts[i + 1];
    if (scope !== 'agent-memory' && scope !== 'agent-memory-local') continue;
    const [agent, ...rest] = parts.slice(i + 2);
    const base = path.join(canonicalProjectRoot(projectRoot), '.claude', scope);
    const dir = agent ? path.join(base, agent) : base;
    return { path: path.join(dir, ...rest), dir, agent: agent || null };
  }
  return null;
}

/**
 * One-sentence retry instruction appended to the deny message.
 * @returns {string} '' when no corrected path can be derived.
 */
function retryAdvice(candidate, projectRoot) {
  const fixed = correctedMemoryPath(candidate, projectRoot);
  if (!fixed) return '';
  return ` Retry with exactly this absolute path: ${fixed.path} ` +
    `(the directory ${fixed.dir} already exists — do not mkdir it, do not use a relative path).`;
}

module.exports = { correctedMemoryPath, retryAdvice };
