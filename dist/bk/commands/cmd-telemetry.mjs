/**
 * cmd-telemetry.mjs — `bk telemetry`: pack anonymized kit telemetry into one file to share.
 *
 * Sharing is the user's choice, so the command stops at the file: it writes the archive, says
 * what is in it, and sends nothing. See lib/telemetry-schema.mjs for what may leave the project.
 * Options: --out <path>, --gitignore, --no-gitignore
 */

import { join, resolve } from 'node:path';
import { askChoice } from '../lib/prompt-choice.mjs';
import { defaultBundleName, exportTelemetry, TelemetryError } from '../lib/telemetry-export.mjs';
import { addBundleIgnore, BUNDLE_PATTERN, bundleNeedsIgnore } from '../lib/telemetry-gitignore.mjs';

/**
 * The closing message. Kept apart from the action so the wording can be tested.
 * @param {string} file — absolute bundle path
 * @returns {string}
 */
export function formatBundleSummary(file) {
  return [
    '',
    `Telemetry bundle ready: ${file}`,
    '',
    'Send this one file to the beer-kit maintainer. Nothing has been sent; sharing is optional.',
    '',
    '  Contains: timings, token and cost figures, hook status, violation types, workflow signals.',
    '  Excludes: source code, file paths, prompts, commands, plan contents, settings.',
    '  Feature, custom agent and MCP tool names are hashed with a random salt used only for this file.',
    '',
    `Check it first: tar tzf "${file}"`,
  ].join('\n');
}

/**
 * Apply the user's gitignore choice for a finished bundle.
 *
 * @param {object} args
 * @param {string} args.root
 * @param {string} args.file
 * @param {boolean|undefined} args.flag — true --gitignore, false --no-gitignore, undefined ask
 * @param {boolean} args.interactive — stdin and stdout are a terminal
 * @param {(line:string)=>void} [args.log]
 * @param {Function} [args.ask] — injected for tests
 */
export async function handleGitignore({ root, file, flag, interactive, log = console.log, ask = askChoice }) {
  if (flag === false || !bundleNeedsIgnore(root, file)) return;

  let add = flag === true;
  if (flag === undefined) {
    if (!interactive) {
      log(`\nThis file is not git-ignored. To keep it out of commits, add this line to .gitignore:\n  ${BUNDLE_PATTERN}`);
      return;
    }
    const answer = await ask({
      question: `\nAdd ${BUNDLE_PATTERN} to .gitignore so this file is never committed?`,
      choices: [{ value: 'yes' }, { value: 'no' }],
      defaultValue: 'yes',
    });
    add = answer === 'yes';
  }
  if (add && addBundleIgnore(root)) log(`Added ${BUNDLE_PATTERN} to .gitignore`);
}

/** @param {import('commander').Command} program */
export function registerTelemetry(program) {
  program
    .command('telemetry')
    .description('Pack anonymized kit telemetry into one file you can choose to share')
    .option('--out <path>', 'Where to write the bundle (default: project root)')
    .option('--gitignore', 'Add the bundle pattern to .gitignore without asking')
    .option('--no-gitignore', 'Leave .gitignore alone')
    .action(async (opts) => {
      const root = process.cwd();
      const file = opts.out ? resolve(root, opts.out) : join(root, defaultBundleName());
      try {
        exportTelemetry({ root, out: file });
      } catch (err) {
        if (!(err instanceof TelemetryError)) throw err;
        console.error(err.message);
        process.exitCode = 1;
        return;
      }
      console.log(formatBundleSummary(file));
      await handleGitignore({
        root,
        file,
        flag: opts.gitignore,
        interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
      });
    });
}
