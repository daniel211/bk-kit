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
 * Mock env overrides (tests — never shell out to a real dart/swiftlint):
 *   BK_LINT_MOCK_CMD_LOG=<path>  — append each command that would run, one per line
 *   BK_LINT_MOCK_EXIT=<n>        — pretend the command exited with this code
 *   BK_LINT_MOCK_OUTPUT=<text>   — pretend this was its combined output
 *
 * Exports:
 *   DEFAULT_LINT_COMMANDS, MAX_PER_FILE_RUNS
 *   quotePath(p), buildBatchCommands(opts), runLintCommand(cmd, opts)
 */

'use strict';

const { execSync } = require('child_process');
const fs = require('fs');

/** Batch-capable defaults per platform. Each takes a list of quoted paths. */
const DEFAULT_LINT_COMMANDS = {
  ios:     (paths) => `swiftlint lint --quiet ${paths}`,
  // ktlint via gradle is whole-project; individual paths are neither needed nor accepted.
  android: ()      => './gradlew ktlintCheck',
  flutter: (paths) => `dart analyze ${paths}`
};

/**
 * Platforms whose linter takes file paths as trailing positional arguments.
 * A custom command for these can be scoped to the batch even without a {file}
 * placeholder — which is the common case, since the shipped platform contexts
 * carry bare commands like `dart analyze` and `swiftlint lint --strict`.
 * Android is absent on purpose: its lint is a whole-project gradle task.
 */
const PATH_TAKING_PLATFORMS = ['ios', 'flutter'];

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
      if (PATH_TAKING_PLATFORMS.includes(platform) && mode !== 'per-file') {
        return [`${lintCommand} ${list.map(quotePath).join(' ')}`];
      }
      if (PATH_TAKING_PLATFORMS.includes(platform)) {
        return list.slice(0, MAX_PER_FILE_RUNS).map((f) => `${lintCommand} ${quotePath(f)}`);
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
 * Run one lint command. Never throws: a non-zero exit, a missing binary and a
 * timeout all come back as a result object.
 *
 * @param {string} cmd
 * @param {{cwd?: string, timeoutMs?: number}} [opts]
 * @returns {{ ok: boolean, output: string, timedOut: boolean }}
 */
function runLintCommand(cmd, opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const timeoutMs = opts.timeoutMs || 60000;

  const cmdLog = process.env.BK_LINT_MOCK_CMD_LOG;
  if (cmdLog) {
    try { fs.appendFileSync(cmdLog, cmd + '\n', 'utf8'); } catch { /* fail-open */ }
    const exit = parseInt(process.env.BK_LINT_MOCK_EXIT || '0', 10);
    return { ok: exit === 0, output: process.env.BK_LINT_MOCK_OUTPUT || '', timedOut: false };
  }

  try {
    execSync(cmd, {
      encoding: 'utf8',
      timeout: timeoutMs,
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd
    });
    return { ok: true, output: '', timedOut: false };
  } catch (err) {
    const output = String((err && err.stdout) || '') + String((err && err.stderr) || '');
    const timedOut = Boolean(err && (err.signal === 'SIGTERM' || err.killed));
    return { ok: false, output: output || (err && err.message) || '', timedOut };
  }
}

module.exports = {
  DEFAULT_LINT_COMMANDS,
  PATH_TAKING_PLATFORMS,
  MAX_PER_FILE_RUNS,
  quotePath,
  hasCustomCommand,
  buildBatchCommands,
  runLintCommand
};
