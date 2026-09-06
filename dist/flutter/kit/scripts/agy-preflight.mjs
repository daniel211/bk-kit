/**
 * agy-preflight.mjs — Decide whether the Antigravity CLI ("agy") can actually do the work
 * before anything is dispatched to it, and resolve which engine a design run should use.
 *
 * The design pipeline can run on two engines that produce the same output contract:
 *   claude — the design-validator / design-spec-writer / design-asset-exporter trio
 *   agy    — the same extraction driven by Gemini through the Antigravity CLI
 *
 * Both read Figma the same way: over the REST API, from Node, via scripts/figma-cli.mjs.
 * Neither uses a Figma MCP server. An earlier version probed for one and had to classify
 * which of two incompatible servers was registered; that whole problem disappeared with the
 * data path, and the checks that went with it were deleted rather than left to rot.
 *
 * agy is the intended destination, but the shipped default stays `claude` until the probes
 * below have been proven on real machines. Flipping the default is a one-line change here;
 * see docs/kit-dev/plan-design-engine-agy.md §Phase 3 for the evidence required first.
 */

import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * The engine used when nothing else is specified.
 *
 * Phase 1 ships `claude`. Do not flip this to `agy` on taste — the plan lists the five
 * conditions that must hold first, and every one of them is measurable.
 */
export const DEFAULT_DESIGN_ENGINE = 'claude';

export const SUPPORTED_ENGINES = ['claude', 'agy', 'dual'];

/**
 * Run a command and return stdout, or null when it fails or does not exist.
 *
 * @param {string} cmd
 * @returns {string|null}
 */
function commandOutput(cmd) {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });
  } catch (_) {
    return null;
  }
}

/**
 * Locate the agy binary on any host OS.
 *
 * `which` is absent on Windows and not guaranteed by POSIX; `where` is the Windows
 * equivalent and `command -v` the portable shell builtin elsewhere.
 *
 * @param {object} [env]
 * @returns {string|null}
 */
export function findAgyBinary(env = process.env) {
  if (env.AGY_CLI_PATH) return env.AGY_CLI_PATH;
  if (env.GEMINI_CLI_PATH) return env.GEMINI_CLI_PATH;   // pre-migration name, still honoured
  const probe = process.platform === 'win32' ? 'where agy' : 'command -v agy';
  const out = commandOutput(probe);
  // `where` can list several matches — take the first.
  return out ? (out.split('\n')[0].trim() || null) : null;
}

/**
 * The allow-rules an agy design run needs.
 *
 * Headless agy cannot prompt for tool approval, so anything not pre-approved is auto-denied
 * and the run returns SUCCESS with an empty response. The kit never passes
 * `--dangerously-skip-permissions`: that would auto-approve every tool including shell
 * commands, on the end user's own repo. Named rules are the whole safety story here, so they
 * are deliberately narrow.
 *
 * There is no `mcp(...)` rule and no Figma MCP server. Figma is read over its REST API by
 * the runner itself, in Node, before agy is invoked — so the model reads local JSON files
 * and writes into one directory, and nothing else is granted.
 *
 * The write rule is an ABSOLUTE path. agy checks permissions against the absolute path it
 * resolved, and it resolves relative paths against its own workspace rather than the calling
 * shell's directory — a run from this repo was observed resolving `bk/dev/...` against an
 * unrelated project elsewhere on the machine. A relative rule therefore matches nothing, and
 * silently.
 *
 * @param {string} flowDir — flow path, absolute or relative to the current directory
 * @returns {string[]}
 */
export function requiredAllowRules(flowDir) {
  const dir = resolve(String(flowDir)).replace(/\/+$/, '');
  return [
    'read_file(*)',
    `write_file(${dir}/**)`
  ];
}

/**
 * A copy-pasteable settings.json snippet for the rules above.
 *
 * The kit does not write this file. It belongs to the user's own CLI, it is shared with
 * every other agy session on the machine, and a tool that silently widens its own
 * permissions is exactly the tool nobody should trust.
 *
 * @param {string[]} rules
 * @returns {string}
 */
export function allowRulesSnippet(rules) {
  return JSON.stringify({ permissions: { allow: rules } }, null, 2);
}

export const AGY_SETTINGS_PATH = '~/.gemini/antigravity-cli/settings.json';

/**
 * Classify the stderr of a failed headless run.
 *
 * agy distinguishes two denial classes, and they need different advice:
 *   'allowable'   — "Add an allow-rule under permissions.allow" → the user can fix this
 *   'unallowable' — "Settings allow-rules do not apply" → only the dangerous flag would
 *                   work, which this kit does not use, so the honest answer is to fall
 *                   back to the claude engine rather than pretend there is a fix.
 *
 * @param {string} stderr
 * @returns {'allowable'|'unallowable'|null}
 */
export function classifyDenial(stderr) {
  const text = String(stderr || '');
  if (!/auto-denied/i.test(text)) return null;
  if (/allow-rules do not apply/i.test(text)) return 'unallowable';
  if (/permissions\.allow/i.test(text)) return 'allowable';
  return 'allowable';
}

/**
 * Resolve the engine for a design run, in priority order:
 *   explicit flag → BK_DESIGN_ENGINE env → platform-context designEngine → default.
 *
 * @param {object} opts
 * @param {string} [opts.flag]
 * @param {object} [opts.env]
 * @param {object} [opts.platformContext]
 * @returns {{engine: string, source: string, error: string|null}}
 */
export function resolveEngine({ flag, env = process.env, platformContext = {} } = {}) {
  const candidates = [
    [flag, 'the --engine flag'],
    [env.BK_DESIGN_ENGINE, 'BK_DESIGN_ENGINE'],
    [platformContext.designEngine, 'platform-context.json'],
    [DEFAULT_DESIGN_ENGINE, 'the built-in default']
  ];
  for (const [value, source] of candidates) {
    if (!value) continue;
    const engine = String(value).toLowerCase();
    if (!SUPPORTED_ENGINES.includes(engine)) {
      return {
        engine: DEFAULT_DESIGN_ENGINE,
        source,
        error: `Unsupported design engine "${value}" (from ${source}). `
          + `Expected one of: ${SUPPORTED_ENGINES.join(', ')}.`
      };
    }
    return { engine, source, error: null };
  }
  return { engine: DEFAULT_DESIGN_ENGINE, source: 'the built-in default', error: null };
}

/**
 * Check only that agy exists and can be invoked.
 *
 * Separate from `preflightAgy` because not every agy caller needs Figma: visual comparison
 * hands the model two local PNGs and needs no MCP server at all. Demanding one would refuse
 * a machine that is perfectly able to do the work.
 *
 * @param {object} [opts]
 * @param {object} [opts.env]
 * @param {(cmd: string) => string|null} [opts.runner]
 * @returns {{ok: boolean, binary: string|null, reason: string|null, remedy: string|null}}
 */
export function preflightAgyBinary({ env = process.env, runner = commandOutput } = {}) {
  const binary = env.AGY_CLI_PATH || env.GEMINI_CLI_PATH || (() => {
    const probe = process.platform === 'win32' ? 'where agy' : 'command -v agy';
    const out = runner(probe);
    return out ? (out.split('\n')[0].trim() || null) : null;
  })();

  if (!binary) {
    return {
      ok: false,
      binary: null,
      reason: 'Antigravity CLI ("agy") is not on PATH.',
      remedy: 'Install it and run "agy" once to authenticate.'
    };
  }
  return { ok: true, binary, reason: null, remedy: null };
}
