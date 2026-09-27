/**
 * claude-code-version.mjs — Is the installed Claude Code new enough for `omitClaudeMd`?
 *
 * Every kit agent sets `omitClaudeMd: true` so subagents skip CLAUDE.md and the always-on
 * conductor rules (X-Game-Pro field: ~58k chars re-read on every subagent request, ~10.5k
 * tokens of it conductor-only). Claude Code honours the key from 2.1.271; older versions
 * ignore unknown frontmatter, so nothing breaks — the subagents just keep loading every rule
 * and also get subagent-init's digest on top. That is a cost, not a fault, hence a warning.
 */

import { execFileSync } from 'node:child_process';

/** First Claude Code release that honours `omitClaudeMd` in agent frontmatter. */
export const OMIT_CLAUDE_MD_MIN_VERSION = '2.1.271';

/**
 * Pull `x.y.z` out of `claude --version` output ("2.1.283 (Claude Code)").
 * @param {string} output
 * @returns {string|null}
 */
export function parseClaudeVersion(output) {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(output || ''));
  return m ? `${m[1]}.${m[2]}.${m[3]}` : null;
}

/**
 * Numeric semver compare of `x.y.z` strings.
 * @returns {number} <0 when a < b, 0 when equal, >0 when a > b
 */
export function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

/**
 * Read the installed Claude Code version. `BK_CLAUDE_VERSION` overrides the probe (tests, and
 * machines where `claude` is not on the PATH of the shell running doctor).
 * @returns {string|null} version, or null when it cannot be determined
 */
export function detectClaudeVersion() {
  if (process.env.BK_CLAUDE_VERSION) return parseClaudeVersion(process.env.BK_CLAUDE_VERSION);
  try {
    const out = execFileSync('claude', ['--version'], {
      encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'],
      shell: process.platform === 'win32'
    });
    return parseClaudeVersion(out);
  } catch (_) {
    return null;
  }
}
