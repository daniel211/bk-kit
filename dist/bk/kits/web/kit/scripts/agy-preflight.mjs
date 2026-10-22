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
 * The shipped default is `auto`: use agy when this machine can actually run it, and use
 * claude otherwise, without narrating a failure that is not one. That replaces the older
 * plan of flipping the default to `agy` once enough evidence accumulated — flipping it would
 * have made every machine without agy explain itself on every single flow, and those users
 * did nothing wrong. See docs/kit-dev/plan-design-engine-auto.md for the reasoning and for
 * what `auto` does differently from `agy` (only the volume of the fallback message).
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  AGY_SETTINGS_PATH, requiredAllowRules, allowRulesSnippet, readAgySettings, rulesCover
} from './agy-allow-rules.mjs';

/**
 * The engine used when nothing else is specified.
 *
 * `auto` is a decision, not an absence of one: it means "agy if this machine is ready for it,
 * claude if not, and do not make a fuss either way". It is safe as a default precisely
 * because it can never leave a user worse off than `claude` did — every machine that fails
 * the preflight sees exactly what it saw before, minus the remedy text it cannot act on.
 */
export const DEFAULT_DESIGN_ENGINE = 'auto';

export const SUPPORTED_ENGINES = ['auto', 'claude', 'agy', 'dual'];

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
 * The command that asks the host OS where `agy` lives.
 *
 * `which` is absent on Windows and not guaranteed by POSIX; `where` is the Windows
 * equivalent and `command -v` the portable shell builtin elsewhere.
 *
 * The platform arrives as an argument rather than being read from `process.platform` inside,
 * because this used to be the same ternary written twice — once in findAgyBinary, once in
 * preflightAgyBinary — and both read the real platform directly. That made the `where agy`
 * branch unreachable from a test on any non-Windows machine, so the CRLF handling below it
 * was never exercised and a Windows regression there would have shipped unnoticed.
 *
 * @param {string} platform — a `process.platform` value
 * @returns {string}
 */
function agyProbeCommand(platform) {
  return platform === 'win32' ? 'where agy' : 'command -v agy';
}

/**
 * Read the first path out of a probe's stdout.
 *
 * `where` lists every match, one per line, and terminates them with CRLF — so the trim is
 * load-bearing: without it the binary path carries a trailing `\r` into every later use of it.
 *
 * @param {string|null} out
 * @returns {string|null}
 */
function firstProbeMatch(out) {
  return out ? (out.split('\n')[0].trim() || null) : null;
}

/**
 * Locate the agy binary on any host OS.
 *
 * @param {object} [env]
 * @param {object} [opts]
 * @param {string} [opts.platform] — defaults to the real host; overridden by tests so that
 *   the Windows probe is covered from POSIX CI rather than only where it is already in use
 * @returns {string|null}
 */
export function findAgyBinary(env = process.env, { platform = process.platform } = {}) {
  if (env.AGY_CLI_PATH) return env.AGY_CLI_PATH;
  if (env.GEMINI_CLI_PATH) return env.GEMINI_CLI_PATH;   // pre-migration name, still honoured
  return firstProbeMatch(commandOutput(agyProbeCommand(platform)));
}

// The rules themselves, and whether this machine already has them, live in their own module
// because the preflight grew past the point where one file could hold both comfortably. They
// are re-exported here so every existing importer — the design runner, bk-visual-verify, the
// docs — keeps working against the same entry point.
export {
  AGY_SETTINGS_PATH, requiredAllowRules, allowRulesSnippet, readAgySettings, rulesCover
} from './agy-allow-rules.mjs';

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
 * The tools this kit's allow-rules actually grant — see `requiredAllowRules`.
 *
 * Anything outside this list is not an oversight in the snippet: the kit reads and writes
 * one flow directory and needs nothing else, and it never passes
 * --dangerously-skip-permissions.
 */
export const KIT_GRANTED_TOOLS = ['read_file', 'write_file'];

/**
 * `classifyDenial`, plus **which tool** agy was denied.
 *
 * A sibling rather than a wider return type, so `bk-visual-verify` and the existing tests
 * keep working against the boolean-ish classifier they already use.
 *
 * The reason it exists: agy classifies a denied `command` (shell) call as 'allowable' — its
 * message really does say "Add an allow-rule under permissions.allow" — so the design runner
 * printed the standard snippet, `read_file(*)` and `write_file(<repo>/bk/**)`. On the machine
 * where this happened both rules were already present, and neither has anything to do with a
 * shell denial. The advice told the user to add what they already had. Naming the tool is
 * what lets the caller tell those two situations apart.
 *
 * @param {string} stderr
 * @returns {{kind: 'allowable'|'unallowable'|null, tool: string|null, granted: boolean}}
 *   `tool` is null when agy reported the denial without naming one (its plural
 *   "the tool(s) required approval" form). `granted` says whether the denied tool is one the
 *   kit's own allow-rules cover — i.e. whether the snippet is worth printing at all.
 */
export function describeDenial(stderr) {
  const text = String(stderr || '');
  const kind = classifyDenial(text);
  if (!kind) return { kind: null, tool: null, granted: false };
  // The exact shape agy emits: `a tool required the "command" permission that headless mode
  // cannot prompt for`.
  const match = text.match(/a tool required the "([^"]+)" permission/i);
  const tool = match ? match[1] : null;
  return { kind, tool, granted: Boolean(tool) && KIT_GRANTED_TOOLS.includes(tool) };
}

/**
 * Resolve the engine for a design run, in priority order:
 *   explicit flag → BK_DESIGN_ENGINE env → platform-context designEngine → default.
 *
 * @param {object} opts
 * @param {string} [opts.flag]
 * @param {object} [opts.env]
 * @param {object} [opts.platformContext]
 * @returns {{engine: string, requested: string, source: string, error: string|null}}
 *   `requested` is the same value as `engine`, carried separately because everything
 *   downstream has to distinguish "the user typed agy" from "we chose agy on their behalf".
 *   Once `resolveEffectiveEngine` has replaced `engine` with a fallback, that distinction is
 *   no longer recoverable from `engine` alone, and it decides how loud the fallback is.
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
        requested: DEFAULT_DESIGN_ENGINE,
        source,
        error: `Unsupported design engine "${value}" (from ${source}). `
          + `Expected one of: ${SUPPORTED_ENGINES.join(', ')}.`
      };
    }
    return { engine, requested: engine, source, error: null };
  }
  return {
    engine: DEFAULT_DESIGN_ENGINE,
    requested: DEFAULT_DESIGN_ENGINE,
    source: 'the built-in default',
    error: null
  };
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
 * @param {string} [opts.platform] — defaults to the real host; see agyProbeCommand for why
 *   this is injectable at all
 * @returns {{ok: boolean, binary: string|null, reason: string|null, remedy: string|null}}
 */
export function preflightAgyBinary({
  env = process.env, runner = commandOutput, platform = process.platform
} = {}) {
  // The two env overrides come first, exactly as in findAgyBinary: an explicitly configured
  // path is an answer, so probing PATH after it would only be a chance to disagree with it.
  const binary = env.AGY_CLI_PATH || env.GEMINI_CLI_PATH
    || firstProbeMatch(runner(agyProbeCommand(platform)));

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

/**
 * A soft, best-effort hint about whether agy has been logged in on this machine.
 *
 * It is inferred from the presence of credential files that agy happens to write today:
 * `~/.gemini/google_accounts.json` and `~/.gemini/jetski-standalone-oauth-token`. That is an
 * internal layout belonging to another tool, and it can change without notice.
 *
 * So this NEVER gates anything, and no caller may treat `'unknown'` as a failure. A false
 * negative here would refuse a machine that is working perfectly, in exchange for a warning
 * nobody asked for. The honest place for it is a line in `bk doctor`; if the signal is wrong
 * in the other direction, the per-unit runtime fallback catches it at no extra cost.
 *
 * @param {object} [opts]
 * @param {string} [opts.home] — override for tests; never touch the real ~ from a test
 * @returns {'likely'|'unknown'}
 */
export function agyAuthSignal({ home = homedir() } = {}) {
  const credentials = [
    join(home, '.gemini', 'google_accounts.json'),
    join(home, '.gemini', 'jetski-standalone-oauth-token')
  ];
  return credentials.some((path) => existsSync(path)) ? 'likely' : 'unknown';
}

/** A Windows drive-letter prefix, once separators are forward slashes: `C:/`. */
const DRIVE_PREFIX = /^[A-Za-z]:\//;

/**
 * The flow directory in the shape the messages below must print it.
 *
 * This deliberately mirrors the folding that agy-allow-rules.mjs does internally, because the
 * two shapes appear side by side in a single failure message: `checks[].name` and `reason`
 * quote the flow directory, while `snippet` quotes the rule that `requiredAllowRules` built
 * from the same path — and that one is always forward-slashed. A Windows user was therefore
 * told that `C:\work\bk\dev\feat\design` was not covered by a rule printed as `C:/work/bk/**`,
 * with no way to tell whether the different spelling WAS the reason it did not match.
 *
 * It is duplicated here rather than imported because agy-allow-rules.mjs exports nothing of
 * the kind and is not ours to widen in this pass; if it ever exports its `toComparablePath`,
 * this should become that import. The shapes must not be allowed to drift apart.
 *
 * @param {string} value
 * @returns {string}
 */
function displayPath(value) {
  const slashed = String(value).replace(/\\/g, '/');
  const absolute = DRIVE_PREFIX.test(slashed) ? slashed : resolve(String(value)).replace(/\\/g, '/');
  return absolute.replace(/\/+$/, '') || '/';
}

/**
 * Everything that has to be true before a design run is handed to agy.
 *
 * Two hard gates, cheapest first: the binary has to exist, and the machine's allow-rules have
 * to cover the flow directory. Both are deterministic and both are free — which matters,
 * because the alternative to checking the second one is discovering it from a 19-screen flow
 * that invoked the model 38 times and wrote nothing.
 *
 * Authentication is reported but never decides `ok`; see agyAuthSignal for why.
 *
 * `checks` lists each gate with its own outcome so `bk doctor` can print them one per line
 * instead of collapsing three separate answers into a single pass/fail the user then has to
 * reverse-engineer.
 *
 * @param {object} [opts]
 * @param {string} [opts.flowDir] — the design flow directory the run will write into
 * @param {object} [opts.env]
 * @param {string} [opts.home] — override for tests; never touch the real ~ from a test
 * @param {(cmd: string) => string|null} [opts.runner]
 * @param {string} [opts.platform] — defaults to the real host; see agyProbeCommand
 * @returns {{ok: boolean, binary: string|null, auth: 'likely'|'unknown',
 *            reason: string|null, remedy: string|null, snippet: string|null,
 *            checks: Array<{name: string, ok: boolean|null, detail: string}>}}
 */
export function preflightAgyDesign({
  flowDir, env = process.env, home = homedir(), runner = commandOutput,
  platform = process.platform
} = {}) {
  const checks = [];
  const auth = agyAuthSignal({ home });

  const binaryCheck = preflightAgyBinary({ env, runner, platform });
  checks.push({
    name: 'agy binary on PATH',
    ok: binaryCheck.ok,
    detail: binaryCheck.binary || 'not found'
  });
  if (!binaryCheck.ok) {
    checks.push({ name: 'agy sign-in', ok: null, detail: auth });
    return {
      ok: false, binary: null, auth,
      reason: binaryCheck.reason, remedy: binaryCheck.remedy, snippet: null, checks
    };
  }

  const rules = readAgySettings({ home });
  const covered = flowDir ? rulesCover(rules, flowDir) : false;
  // Every mention of the flow directory from here on is the normalized one, so that this
  // message and the snippet below it spell the same path the same way.
  const shownDir = flowDir ? displayPath(flowDir) : null;
  checks.push({
    name: `allow-rules cover ${shownDir || '(no flow directory given)'}`,
    ok: covered,
    detail: covered ? `${rules.length} rule(s) in ${AGY_SETTINGS_PATH}` : 'not covered'
  });
  checks.push({ name: 'agy sign-in', ok: null, detail: auth });

  if (!covered) {
    const required = requiredAllowRules(flowDir || '.');
    return {
      ok: false,
      binary: binaryCheck.binary,
      auth,
      // Same fallback wording as the check above: with no flowDir the old text interpolated
      // a literal `undefined`, which reads as a crash rather than as a missing argument.
      reason: `${AGY_SETTINGS_PATH} has no allow-rule covering `
        + `${shownDir || '(no flow directory given)'}. `
        + 'Headless agy cannot ask for approval, so every write would be auto-denied.',
      remedy: `Add these rules to ${AGY_SETTINGS_PATH} (the kit does not edit that file for `
        + 'you — it is shared with every other agy session on this machine).',
      snippet: allowRulesSnippet(required),
      checks
    };
  }

  return {
    ok: true, binary: binaryCheck.binary, auth,
    reason: null, remedy: null, snippet: null, checks
  };
}

/**
 * Turn a requested engine into the one that will actually run.
 *
 * This is the single place that decides how loud a fallback is, so that the decision is not
 * re-derived — and re-derived differently — at each call site:
 *
 *   `auto` failing the preflight is not an incident. The user never asked for agy; a machine
 *   without it is not misconfigured, and printing a remedy for a problem nobody has is how a
 *   sensible default becomes an irritation on every flow.
 *
 *   `agy` failing the preflight IS something the user asked about, and they get the reason,
 *   the remedy and the copy-pasteable snippet, because they can act on all three.
 *
 * `claude` and `dual` never touch the preflight at all: probing for a binary neither of them
 * will invoke can only produce a wrong answer.
 *
 * @param {object} opts
 * @param {string} opts.requested — one of SUPPORTED_ENGINES
 * @param {string} [opts.flowDir]
 * @param {object} [opts.env]
 * @param {(o: object) => object} [opts.preflight] — injected for tests
 * @returns {{engine: string, requested: string, reason: string|null, remedy: string|null,
 *            snippet: string|null, verbose: boolean}}
 */
export function resolveEffectiveEngine({
  requested, flowDir, env = process.env, preflight = preflightAgyDesign
} = {}) {
  const verbose = requested !== 'auto';

  if (requested === 'claude' || requested === 'dual') {
    return { engine: requested, requested, reason: null, remedy: null, snippet: null, verbose };
  }

  const result = preflight({ flowDir, env });
  if (result.ok) {
    return { engine: 'agy', requested, reason: null, remedy: null, snippet: null, verbose };
  }
  return {
    engine: 'claude',
    requested,
    reason: result.reason,
    remedy: result.remedy,
    snippet: result.snippet,
    verbose
  };
}
