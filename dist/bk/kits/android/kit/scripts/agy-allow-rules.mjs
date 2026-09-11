/**
 * agy-allow-rules.mjs — The allow-rules an agy design run needs, and whether the machine
 * already has them.
 *
 * Split out of agy-preflight.mjs when the preflight grew from "is the binary there" into a
 * real readiness check; agy-preflight.mjs re-exports everything here, so nothing that
 * imported it before has to change.
 *
 * Headless agy cannot prompt for tool approval, so anything not pre-approved is auto-denied
 * and the run returns SUCCESS with an empty response. That failure is expensive in exactly
 * the way that is hardest to notice: a 19-screen flow spent 38 model invocations discovering
 * that one line of JSON was missing from a file outside the repo. Reading that file first
 * costs nothing, which is what this module is for.
 *
 * The kit only ever READS ~/.gemini/antigravity-cli/settings.json. It belongs to the user's
 * own CLI, it is shared with every other agy session on the machine, and a tool that quietly
 * widens its own permissions is exactly the tool nobody should trust.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export const AGY_SETTINGS_PATH = '~/.gemini/antigravity-cli/settings.json';

/** A Windows drive-letter prefix, once separators are forward slashes: `C:/`. */
const DRIVE_PREFIX = /^[A-Za-z]:\//;

/**
 * Put a path or a glob into one comparable shape: forward slashes, no trailing separator.
 *
 * Everything in this module used to assume POSIX on both sides of the comparison — the glob
 * had to start with `/`, and the tested path came straight out of `resolve()`. On Windows
 * both sides are `C:\repo\bk\...`, so every rule was classified "cannot be read confidently"
 * and NO Windows machine could pass the gate: `auto` silently fell back to claude forever,
 * and `--engine agy` printed a snippet that would not have satisfied the check either. The
 * kit branches on `win32` elsewhere on purpose (findAgyBinary, cmd-doctor), so that was a
 * loss of reach, not a platform the kit had declined to support.
 *
 * A drive-prefixed path is NOT sent through `resolve()`. On Windows `resolve('C:\\repo')` is
 * already `C:\repo`, so nothing is lost there; on POSIX `resolve()` would glue it onto the
 * cwd as a relative name, which is what makes Windows-shaped inputs untestable off Windows.
 *
 * Backslashes are folded unconditionally rather than only under `process.platform === 'win32'`
 * so that the Windows cases in the test suite actually run on macOS/Linux CI. The cost is a
 * POSIX directory whose name literally contains a backslash, which would then compare equal
 * to one containing a slash — both sides are folded the same way, so such a path still
 * matches its own rule, and the collision needs two sibling directories named `a\b` and `a/b`.
 *
 * @param {string} value
 * @returns {string}
 */
function toComparablePath(value) {
  const slashed = String(value).replace(/\\/g, '/');
  const absolute = DRIVE_PREFIX.test(slashed) ? slashed : resolve(String(value)).replace(/\\/g, '/');
  return absolute.replace(/\/+$/, '') || '/';
}

/**
 * The allow-rules an agy design run needs.
 *
 * The kit never passes `--dangerously-skip-permissions`: that would auto-approve every tool
 * including shell commands, on the end user's own repo. Named rules are the whole safety
 * story here, so they are deliberately narrow.
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
 * The write rule is scoped to the repo's whole `bk/` tree rather than to one flow directory,
 * which is where it used to point. A per-flow rule has to be re-added by hand for every new
 * feature, and a rule that must be re-added per feature is a rule nobody enables — which in
 * turn makes an `auto` default meaningless, because no machine would ever pass the check.
 * The scope is still narrow: it is the kit's own output directory, never `command(*)`.
 *
 * When the flow path contains no `bk/` segment we keep the old per-flow scope rather than
 * guess at a repo root, because guessing wrong here means granting writes somewhere the
 * user did not agree to.
 *
 * The emitted rule uses forward slashes on every host, including a drive-lettered Windows
 * path (`C:/repo/bk/**`). That shape is what `rulesCover` compares against, so the snippet
 * this function prints always satisfies the very check that printed it — a preflight that
 * tells the user to paste a rule which then still fails is worse than no preflight at all.
 *
 * @param {string} flowDir — flow path, absolute or relative to the current directory
 * @returns {string[]}
 */
export function requiredAllowRules(flowDir) {
  const dir = toComparablePath(flowDir);
  const segments = dir.split('/');
  const bkIndex = segments.indexOf('bk');
  const scope = bkIndex > 0 ? segments.slice(0, bkIndex + 1).join('/') : dir;
  return [
    'read_file(*)',
    `write_file(${scope}/**)`
  ];
}

/**
 * A copy-pasteable settings.json snippet for the rules above.
 *
 * @param {string[]} rules
 * @returns {string}
 */
export function allowRulesSnippet(rules) {
  return JSON.stringify({ permissions: { allow: rules } }, null, 2);
}

/**
 * Read the allow-rules configured on this machine, without ever writing to the file.
 *
 * A missing file, an unreadable one and invalid JSON all mean the same thing to a caller —
 * "no rules are configured" — and none of them is worth a throw: a preflight that crashes
 * because a settings file is malformed has turned an advisory check into an outage.
 *
 * @param {object} [opts]
 * @param {string} [opts.home] — override for tests; never touch the real ~ from a test
 * @returns {string[]} the `permissions.allow` array, or [] when there is nothing to read
 */
export function readAgySettings({ home = homedir() } = {}) {
  const path = join(home, '.gemini', 'antigravity-cli', 'settings.json');
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (_) {
    return [];
  }
  const allow = parsed?.permissions?.allow;
  return Array.isArray(allow) ? allow.filter((r) => typeof r === 'string') : [];
}

/**
 * Translate one agy path glob into a regular expression, or null when it cannot be read
 * confidently.
 *
 * Only the two wildcards the kit's own documented rules use are translated: `**` spans any
 * suffix including nested directories, `*` spans a single path segment. Anything else —
 * character classes, brace expansion, negation — is refused rather than approximated,
 * because the two errors are not symmetric: a false "you are covered" costs a whole flow
 * that fails 38 times before anyone learns why, while a false "not covered" costs one
 * printed snippet the user can ignore.
 *
 * "Absolute" means a leading `/` OR a drive-letter prefix, so `/repo/bk/**`, `C:/repo/bk/**`
 * and `C:\repo\bk\**` are all accepted and all compare the same way.
 *
 * The comparison is case-insensitive ONLY for a drive-lettered glob. Windows paths are
 * case-insensitive, POSIX ones are not, and folding case unconditionally would let a rule
 * for `/work/bk` grant writes to a genuinely different directory named `/Work/bk` — a
 * silently widened permission, which is the one failure mode this module exists to avoid.
 *
 * @param {string} glob
 * @returns {RegExp|null}
 */
function globToRegExp(glob) {
  if (/[?[\]{}!()]/.test(glob)) return null;       // syntax we do not claim to understand
  const normalized = String(glob).replace(/\\/g, '/');
  const drive = DRIVE_PREFIX.test(normalized);
  if (!drive && !normalized.startsWith('/')) return null;   // agy matches absolute paths only
  let pattern = '';
  for (let i = 0; i < normalized.length; i++) {
    if (normalized[i] === '*' && normalized[i + 1] === '*') { pattern += '.*'; i++; }
    else if (normalized[i] === '*') { pattern += '[^/]*'; }
    else pattern += normalized[i].replace(/[.+^$|\\/]/g, '\\$&');
  }
  return new RegExp(`^${pattern}$`, drive ? 'i' : '');
}

/**
 * Does one rule of the given tool name cover this absolute path?
 *
 * @param {string} rule — e.g. `write_file(/work/bk/**)` or `write_file(C:\work\bk\**)`
 * @param {string} tool — `read_file` or `write_file`
 * @param {string} absPath — already through toComparablePath, with a trailing slash
 * @returns {boolean}
 */
function ruleCovers(rule, tool, absPath) {
  const match = new RegExp(`^${tool}\\((.*)\\)$`).exec(String(rule).trim());
  if (!match) return false;
  const glob = match[1].trim();
  // `*` and `**` as the entire pattern are the one non-absolute form that is unambiguous:
  // they grant the tool everywhere. This is how the kit's own documented read rule is
  // written, so refusing it would reject the exact configuration the kit tells people to use.
  if (glob === '*' || glob === '**') return true;
  const re = globToRegExp(glob);
  return re ? re.test(absPath) : false;
}

/**
 * Do the configured rules grant both reading and writing the flow directory?
 *
 * Both the current repo-level rule `write_file(<repo>/bk/**)` and the older per-flow rule
 * `write_file(<flow>/**)` satisfy this, so a machine configured under the previous scope
 * does not have to change anything.
 *
 * The path is tested with a trailing slash, because that is what makes `<flow>/**` cover the
 * flow directory itself and not merely things beside it.
 *
 * Rule and path are both put into forward-slash form first, so a Windows machine — where
 * both sides arrive as `C:\repo\bk\...` — is compared on equal terms instead of failing
 * every rule outright.
 *
 * @param {string[]} rules — as returned by readAgySettings
 * @param {string} flowDir — flow path, absolute or relative to the current directory
 * @returns {boolean}
 */
export function rulesCover(rules, flowDir) {
  const dir = `${toComparablePath(flowDir)}/`;
  const list = Array.isArray(rules) ? rules : [];
  const canRead = list.some((rule) => ruleCovers(rule, 'read_file', dir));
  const canWrite = list.some((rule) => ruleCovers(rule, 'write_file', dir));
  return canRead && canWrite;
}
