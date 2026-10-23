/**
 * runner-detector.mjs — run a python / web project's commands through its own package runner.
 *
 * The kits ship bare commands (`ruff check .`, `npx eslint .`). A uv project has no global ruff,
 * and a pnpm project's binaries are not where npx looks, so the commands fail on the very first
 * lint (AHub). Contract: docs/kit-dev/plan-be-web-platforms.md § Phase 4.1 item 3.
 *
 * Detection is by lockfile, at the dir the commands run in (a single kit's `root`, or each
 * fullstack component's root). The first matching rule wins; no lockfile = the plain runner
 * (`pip` / `npm`), commands kept. applyRunner() is pure and idempotent: applied to an
 * already-rewritten context it changes nothing, so init, /bk-bootstrap and a rerun can all
 * apply it after the framework merge without `uv run --frozen uv run --frozen`.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** python commands that run project code or project-installed tools. `clean` is plain `rm`. */
const PYTHON_WRAPPED = ['build', 'test', 'lint', 'format', 'typecheck', 'migrate', 'migrationsCheck'];

/** Prefixes that already route a python command through a runner. */
const PYTHON_PREFIXES = ['uv run', 'poetry run'];

/**
 * One rule per lockfile, first match wins.
 *   prefix  — python: prepended to PYTHON_WRAPPED commands
 *   replace — web: [leading text, replacement] pairs, applied at the start of every command
 *   install — the `install` command for this runner
 */
export const RUNNER_RULES = {
  python: [
    { lockfile: 'uv.lock', runner: 'uv', prefix: 'uv run --frozen', install: 'uv sync --frozen' },
    { lockfile: 'poetry.lock', runner: 'poetry', prefix: 'poetry run', install: 'poetry install' },
  ],
  web: [
    { lockfile: 'pnpm-lock.yaml', runner: 'pnpm', replace: [['npx ', 'pnpm exec '], ['npm run ', 'pnpm run ']], install: 'pnpm install --frozen-lockfile' },
    { lockfile: 'yarn.lock', runner: 'yarn', replace: [['npx ', 'yarn '], ['npm run ', 'yarn ']], install: 'yarn install --frozen-lockfile' },
    { lockfile: 'package-lock.json', runner: 'npm', install: 'npm ci' },
  ],
};

/** The runner assumed when no lockfile is found (and when a context records none). */
export const DEFAULT_RUNNERS = { python: 'pip', web: 'npm' };

/**
 * The runner rule for a dir.
 *
 * @param {string} platform - 'python' | 'web'; anything else returns null
 * @param {string} dir - absolute dir the commands run in
 * @returns {{ runner: string, lockfile?: string, prefix?: string, replace?: string[][], install?: string }|null}
 */
export function detectRunner(platform, dir) {
  const rules = RUNNER_RULES[platform];
  if (!rules) return null;
  return rules.find((r) => existsSync(join(dir, r.lockfile))) || { runner: DEFAULT_RUNNERS[platform] };
}

/** One command through a rule; unchanged when it already goes through a runner. */
function rewrite(cmd, rule, key) {
  if (typeof cmd !== 'string' || !cmd) return cmd;
  if (rule.prefix) {
    if (!PYTHON_WRAPPED.includes(key) || PYTHON_PREFIXES.some((p) => cmd.startsWith(`${p} `))) return cmd;
    return `${rule.prefix} ${cmd}`;
  }
  for (const [from, to] of rule.replace || []) {
    if (cmd.startsWith(from)) return to + cmd.slice(from.length);
  }
  return cmd;
}

/**
 * Apply a runner rule to a platform context (single kit or one component). Pure.
 *
 * @param {object} ctx - has `commands`
 * @param {ReturnType<typeof detectRunner>} rule - null leaves ctx untouched
 * @returns {object} ctx with `runner` set and `commands` rewritten
 */
export function applyRunner(ctx, rule) {
  if (!rule) return ctx;
  const commands = {};
  for (const [key, cmd] of Object.entries(ctx.commands || {})) commands[key] = rewrite(cmd, rule, key);
  if (rule.install) commands.install = rule.install;
  return { ...ctx, runner: rule.runner, commands };
}

/**
 * Doctor's runner check: the recorded runner (missing = the platform default) against a fresh
 * detection. A difference is a warning, never an error.
 *
 * @returns {string|null} the difference line, or null when they agree / not a runner platform
 */
export function runnerDifference(ctx, platform, dir) {
  const detected = detectRunner(platform, dir);
  if (!detected) return null;
  const recorded = (ctx && typeof ctx.runner === 'string' && ctx.runner) || DEFAULT_RUNNERS[platform];
  if (recorded === detected.runner) return null;
  const why = detected.lockfile ? ` (${detected.lockfile})` : ' (no lockfile)';
  return `runner: recorded ${ctx && ctx.runner ? recorded : `none (${recorded})`}, detected ${detected.runner}${why}`;
}
