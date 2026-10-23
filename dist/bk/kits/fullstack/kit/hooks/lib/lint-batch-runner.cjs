/**
 * lint-batch-runner.cjs — Build and run ONE lint invocation over a batch of files.
 *
 * The point of the Stop-time lint is that a turn costs one linter run, not one
 * per edit. So this module always prefers a single command over N commands.
 *
 * {file} placeholder handling (the {{lint_command}} template variable):
 *   - `{files}`  → replaced with every quoted path. Explicit batch marker.
 *   - `{file}`   → also replaced with every quoted path. Effectively every
 *                  file-taking linter (dart analyze, swiftlint, ktlint, eslint…)
 *                  accepts a list of paths where it accepts one, and batching is
 *                  the whole reason this hook exists.
 *   - neither    → depends on the platform. swiftlint and dart analyze take paths
 *                  positionally, so the batch is appended and the run stays
 *                  scoped to the edited files (PATH_TAKING_PLATFORMS). Android's
 *                  lint is a gradle task (./gradlew ktlintCheck detekt) that is
 *                  whole-project by construction and rejects stray paths, so it
 *                  runs verbatim, once.
 *   Escape hatch: a custom command that genuinely cannot take more than one path
 *   can set `lint.batch: "per-file"` in .bk.json. That runs the command once per
 *   file (capped by MAX_PER_FILE_RUNS) and pays for it. The built-in per-platform
 *   defaults always batch.
 *
 * Missing tool (Phase 4.1 item 4): exit 127, or stderr saying the shell / OS could not find the
 * binary (MISSING_TOOL_RE), is NOT a lint failure — `ruff` absent from PATH in a uv project used
 * to be reported as lint errors against the turn. runLintCommand flags it `missingTool`; the
 * worker turns it into a once-per-session advisory instead of a finding.
 *
 * Mock env overrides (tests — never shell out to a real dart/swiftlint):
 *   BK_LINT_MOCK_CMD_LOG=<path>  — append each command that would run, one per line
 *   BK_LINT_MOCK_CWD_LOG=<path>  — with the above: append each command's cwd, one per line
 *   BK_LINT_MOCK_EXIT=<n>        — pretend the command exited with this code (127 = missing tool)
 *   BK_LINT_MOCK_OUTPUT=<text>   — pretend this was its combined output (also read as stderr)
 *
 * Exports:
 *   DEFAULT_LINT_COMMANDS, PATH_TAKING_PLATFORMS, NATIVE_SUPERSET_PLATFORMS,
 *   NATIVE_LINT_BINARIES, MAX_PER_FILE_RUNS
 *   quotePath(p), usesSameBinaryAsNative(platform, cmd), buildBatchCommands(opts),
 *   buildComponentBatches(opts) — one batch per component, own cwd + command,
 *   baseLintCommand(platform, cmd), MISSING_TOOL_RE, runLintCommand(cmd, opts)
 */

'use strict';

const { execSync } = require('child_process');
const fs = require('fs');

/** Batch-capable defaults per platform. Each takes a list of quoted paths. */
const DEFAULT_LINT_COMMANDS = {
  ios:     (paths) => `swiftlint lint --quiet ${paths}`,
  // ktlint via gradle is whole-project; individual paths are neither needed nor accepted.
  android: ()      => './gradlew ktlintCheck',
  flutter: (paths) => `dart analyze ${paths}`,
  // ruff and eslint both take a list of paths positionally and lint only those.
  python:  (paths) => `ruff check ${paths}`,
  web:     (paths) => `npx eslint ${paths}`
};

/**
 * Platforms whose linter takes file paths as trailing positional arguments.
 * A custom command for these can be scoped to the batch even without a {file}
 * placeholder — which is the common case, since the shipped platform contexts
 * carry bare commands like `dart analyze` and `swiftlint lint --strict`.
 * Android is absent on purpose: its lint is a whole-project gradle task.
 */
const PATH_TAKING_PLATFORMS = ['ios', 'flutter', 'python', 'web'];

/**
 * A bare command whose last argument is the project root — `ruff check .`, `npx eslint .`,
 * which is exactly what the shipped python and web platform contexts carry.
 *
 * Appending the batch to it verbatim would give `ruff check . "a.py"`: both tools lint the
 * union of their path arguments, so the `.` makes every Stop lint the WHOLE repo and report
 * every pre-existing finding against the turn that touched one file. The trailing `.` is
 * therefore dropped before the batch is appended — the edited paths replace the root target,
 * they do not add to it. Only a lone final `.` or `./` token counts; `--config ./x.toml` or a
 * real subdirectory target is left alone.
 */
const WHOLE_PROJECT_TARGET = /\s+\.\/?\s*$/;

/**
 * Platforms where a file already queued for the Stop-time native lint does NOT also
 * need the batch lint above — because the native run covers it completely.
 *
 * The test a platform has to pass, both halves required:
 *   1. same binary — the two paths drive the same tool, not two tools that happen
 *      to both be called "lint";
 *   2. no weaker in severity — the native command must not drop a flag that changes
 *      how findings are CLASSIFIED. Severity is not cosmetic here: with the shipped
 *      `red_on_error_only: true`, an error becomes a red signal the kill switch
 *      weighs, and a warning becomes a yellow one it does not. Deferring a batch to
 *      a command that reports the same problems at a lower severity silently moves
 *      when the harness halts.
 *
 * flutter passes. Shipped `dart analyze` (platform-context.flutter.json) vs native
 * `dart analyze --format=json`: same binary, and --format only changes the encoding
 * of the output, never the severity of a diagnostic.
 *
 * ios FAILS the second half and is deliberately absent — do not "helpfully" add it
 * back. Shipped `swiftlint lint --strict` vs native
 * `swiftlint lint --quiet --reporter json [--config <cfg>]`: same binary, but the
 * native side has no --strict, and --strict is exactly what escalates swiftlint
 * warnings to errors. Deferring an ios batch would therefore downgrade every
 * swiftlint warning from red to yellow. Restoring ios means making the native ios
 * command carry --strict first.
 *
 * android FAILS the first half: `./gradlew ktlintCheck` (formatting/style) and
 * `./gradlew detekt --format xml --input <paths>` (static analysis) are different
 * tools checking different things. Deduping there would silently drop all ktlint
 * coverage. android must keep running both.
 *
 * python and web are absent for a more basic reason: there is no native run to defer
 * to. No arch-fitness-python-native / arch-fitness-web-native hook ships, so nothing
 * ever enqueues their files on the native queue, and the batch lint is the ONLY lint
 * they get. Adding them here would at best be a no-op (computeDeferredPaths reads an
 * empty native queue) and at worst, once a native hook did exist without a ruff/eslint
 * severity mapping for the kill switch, silently trade the batch run for a weaker one.
 * They have no NATIVE_LINT_BINARIES entry either, so usesSameBinaryAsNative() is false.
 */
const NATIVE_SUPERSET_PLATFORMS = ['flutter'];

/**
 * The binary native-lint-runner.cjs's buildCommand() actually invokes per platform.
 * Kept here so the "same binary" half of the test above can be checked against a
 * project's configured lint command instead of assumed.
 */
const NATIVE_LINT_BINARIES = {
  ios:     'swiftlint',
  android: 'gradlew',
  flutter: 'dart'
};

/**
 * stderr of a command whose binary does not exist: POSIX sh, cmd.exe, node spawn, and the project
 * runners the kit prefixes lint commands with — `uv run` ("Failed to spawn: `ruff`"), pnpm / yarn
 * (`Command "eslint" not found`) and npx without the package installed. Found on AHub: the shell-level
 * patterns alone missed `uv run --frozen ruff` with ruff absent, which exits 2, not 127.
 */
const MISSING_TOOL_RE = new RegExp([
  'command not found',
  'not recognized as an internal or external command',
  'ENOENT',
  'Failed to spawn: `[^`]+`',
  'Command "[^"]+" not found',
  'npx canceled due to missing packages',
  'could not determine executable to run'
].join('|'));

/** Upper bound on runs when a custom command is declared per-file only. */
const MAX_PER_FILE_RUNS = 20;

/**
 * Shell-quote a path for inclusion in a command string.
 * @param {string} p
 * @returns {string}
 */
function quotePath(p) {
  return `"${String(p).replace(/(["$`\\])/g, '\\$1')}"`;
}

/**
 * Is this a usable template-injected lint command, or an unrendered placeholder?
 * @param {string} cmd
 * @returns {boolean}
 */
function hasCustomCommand(cmd) {
  return Boolean(cmd) && cmd !== '{{lint_command}}' && cmd.trim() !== '';
}

/**
 * Build the command list to run for a batch of files.
 * Returns one command in every case except an explicit per-file custom command.
 *
 * @param {{platform: string, files: string[], lintCommand?: string, mode?: 'auto'|'per-file'}} opts
 * @returns {string[]} commands to execute in order (possibly empty)
 */
function buildBatchCommands(opts) {
  const { platform, files, lintCommand, mode } = opts || {};
  const list = Array.isArray(files) ? files.filter(Boolean) : [];
  if (list.length === 0) return [];

  if (hasCustomCommand(lintCommand)) {
    const takesFiles = lintCommand.includes('{file}') || lintCommand.includes('{files}');
    if (!takesFiles) {
      // No placeholder. Scope it to the batch where the platform's linter takes
      // paths; otherwise it is a whole-project command — run it verbatim, once.
      const scoped = lintCommand.replace(WHOLE_PROJECT_TARGET, '');
      if (PATH_TAKING_PLATFORMS.includes(platform) && mode !== 'per-file') {
        return [`${scoped} ${list.map(quotePath).join(' ')}`];
      }
      if (PATH_TAKING_PLATFORMS.includes(platform)) {
        return list.slice(0, MAX_PER_FILE_RUNS).map((f) => `${scoped} ${quotePath(f)}`);
      }
      return [lintCommand];
    }
    if (mode === 'per-file') {
      return list.slice(0, MAX_PER_FILE_RUNS).map((f) =>
        lintCommand.split('{files}').join(quotePath(f)).split('{file}').join(quotePath(f))
      );
    }
    const joined = list.map(quotePath).join(' ');
    return [lintCommand.split('{files}').join(joined).split('{file}').join(joined)];
  }

  const builder = DEFAULT_LINT_COMMANDS[platform];
  if (!builder) return [];
  return [builder(list.map(quotePath).join(' '))];
}

/**
 * A composite kit's batch (fullstack): group the files by owning component and build each
 * component's commands with ITS platform and ITS `commands.lint` (the component platform's
 * DEFAULT_LINT_COMMANDS when it has none), to run with cwd = the component root — eslint finds
 * its flat config from the cwd, and `ruff check .` with the trailing `.` stripped lints only the
 * batch either way. Paths stay absolute, as for a plain kit, so findings name the real files.
 * Files no component owns are dropped (componentForFile → null).
 *
 * A single-stack kit is one component (component-resolver: `{ platform, root }` from its
 * top-level `root`), so the same grouping gives it cwd = root; `fallbackLintCommand` (the
 * build-time {{lint_command}}) stands in when its context carries no `commands.lint`.
 *
 * @param {{ projectRoot: string, files: string[], mode?: 'auto'|'per-file', fallbackLintCommand?: string }} opts
 * @returns {Array<{ id: string, platform: string, root: string, cwd: string, files: string[],
 *   lintCommand: string, commands: string[] }>}
 */
function buildComponentBatches(opts) {
  const { projectRoot, files, mode, fallbackLintCommand } = opts || {};
  const { componentForFile, componentCwd } = require('./component-resolver.cjs');
  const groups = new Map();
  for (const file of Array.isArray(files) ? files.filter(Boolean) : []) {
    const component = componentForFile(file, projectRoot);
    if (!component) continue;
    if (!groups.has(component.id)) groups.set(component.id, { component, files: [] });
    groups.get(component.id).files.push(file);
  }
  return [...groups.values()].map(({ component, files: list }) => {
    const own = component.commands && typeof component.commands.lint === 'string' ? component.commands.lint : '';
    const lintCommand = hasCustomCommand(own) ? own : (fallbackLintCommand || '');
    return {
      id: component.id,
      platform: component.platform,
      root: component.root,
      cwd: componentCwd(component, projectRoot),
      files: list,
      lintCommand,
      commands: buildBatchCommands({ platform: component.platform, files: list, lintCommand, mode })
    };
  });
}

/**
 * The command as configured, without the batch — what a missing-tool advisory names
 * (`ruff check .`, or the platform default's leading part when nothing is configured).
 * @param {string} platform
 * @param {string} [lintCommand]
 * @returns {string}
 */
function baseLintCommand(platform, lintCommand) {
  if (hasCustomCommand(lintCommand)) return lintCommand.trim();
  const builder = DEFAULT_LINT_COMMANDS[platform];
  return builder ? builder('').trim() : '';
}

/**
 * Does this project's configured lint command invoke the same binary the native
 * lint path would? A leading-token comparison, deliberately not a parser.
 *
 * Without it, a user who points `lint_command` at something else entirely on a
 * NATIVE_SUPERSET_PLATFORMS platform (a formatter, a wrapper script) would have that
 * command silently skipped in favour of a `dart analyze` that never ran it.
 *
 * @param {string} platform
 * @param {string} [lintCommand] — the template-injected command, if any
 * @returns {boolean}
 */
function usesSameBinaryAsNative(platform, lintCommand) {
  const expected = NATIVE_LINT_BINARIES[platform];
  if (!expected) return false;
  const builder = DEFAULT_LINT_COMMANDS[platform];
  // No custom command means the default above runs — compare that instead.
  const effective = hasCustomCommand(lintCommand) ? lintCommand : (builder ? builder('') : '');
  const leading = String(effective).trim().split(/\s+/)[0] || '';
  // `./gradlew` and `/usr/bin/dart` are the same binaries as `gradlew` and `dart`.
  return leading.split('/').pop() === expected;
}

/**
 * Run one lint command. Never throws: a non-zero exit, a missing binary and a
 * timeout all come back as a result object.
 *
 * @param {string} cmd
 * @param {{cwd?: string, timeoutMs?: number}} [opts]
 * @returns {{ ok: boolean, output: string, timedOut: boolean, missingTool: boolean }}
 */
function runLintCommand(cmd, opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const timeoutMs = opts.timeoutMs || 60000;

  const cmdLog = process.env.BK_LINT_MOCK_CMD_LOG;
  if (cmdLog) {
    try { fs.appendFileSync(cmdLog, cmd + '\n', 'utf8'); } catch { /* fail-open */ }
    if (process.env.BK_LINT_MOCK_CWD_LOG) {
      try { fs.appendFileSync(process.env.BK_LINT_MOCK_CWD_LOG, cwd + '\n', 'utf8'); } catch { /* fail-open */ }
    }
    const exit = parseInt(process.env.BK_LINT_MOCK_EXIT || '0', 10);
    const output = process.env.BK_LINT_MOCK_OUTPUT || '';
    return {
      ok: exit === 0, output, timedOut: false,
      missingTool: exit !== 0 && (exit === 127 || MISSING_TOOL_RE.test(output))
    };
  }

  try {
    execSync(cmd, {
      encoding: 'utf8',
      timeout: timeoutMs,
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd
    });
    return { ok: true, output: '', timedOut: false, missingTool: false };
  } catch (err) {
    const stderr = String((err && err.stderr) || '');
    const output = String((err && err.stdout) || '') + stderr;
    const timedOut = Boolean(err && (err.signal === 'SIGTERM' || err.killed));
    // 127 = the shell found no such command; a spawn error (no shell) carries ENOENT in its code.
    const missingTool = !timedOut && (
      (err && err.status === 127) || (err && err.code === 'ENOENT') || MISSING_TOOL_RE.test(stderr)
    );
    return { ok: false, output: output || (err && err.message) || '', timedOut, missingTool };
  }
}

module.exports = {
  DEFAULT_LINT_COMMANDS,
  PATH_TAKING_PLATFORMS,
  NATIVE_SUPERSET_PLATFORMS,
  NATIVE_LINT_BINARIES,
  MAX_PER_FILE_RUNS,
  MISSING_TOOL_RE,
  quotePath,
  baseLintCommand,
  hasCustomCommand,
  buildComponentBatches,
  usesSameBinaryAsNative,
  buildBatchCommands,
  runLintCommand
};
