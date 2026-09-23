/**
 * cmd-doctor.mjs — Validate .claude/ kit installation health.
 *
 * Checks file existence, JSON validity, and optional hash integrity.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import { reportHookPerf } from '../lib/hook-perf-measure.mjs';
import { packageRootFrom } from '../lib/package-layout.mjs';
import { addKitOption, resolveKitOrExit } from '../lib/kit-resolver.mjs';
import { detectDrift, formatDriftList, readDoctorIgnore } from '../lib/kit-drift.mjs';
import {
  appendIgnoreCommand, missingIgnoreEntries, trackedSessionState, untrackCommand,
} from '../lib/session-state-gitignore.mjs';

/**
 * Check whether an executable is on PATH, on any host OS.
 *
 * `which` is neither present on Windows nor guaranteed by POSIX; `where` is the
 * Windows equivalent and `command -v` is the portable shell builtin elsewhere.
 *
 * @param {string} bin
 * @returns {boolean}
 */
function hasCommand(bin) {
  const probe = process.platform === 'win32' ? `where ${bin}` : `command -v ${bin}`;
  try {
    execSync(probe, { stdio: 'ignore' });
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Install hint for Antigravity CLI, the reviewer's backing CLI since kit 0.2.0.
 *
 * Matched to the host: `agy` runs natively on macOS, Linux and Windows, but the install
 * channel differs. The retired `gemini` CLI is deliberately not offered.
 *
 * @returns {string}
 */
function agyInstallHint() {
  if (process.platform === 'darwin') return '"brew install --cask antigravity-cli"';
  if (process.platform === 'win32') return 'the installer at https://antigravity.google/docs/cli/install/';
  return '"curl -fsSL https://antigravity.google/cli/install.sh | bash"';
}

/**
 * Report which engine design extraction would pick on this machine right now, and — when the
 * answer is "claude" — exactly what is missing.
 *
 * The design engine defaults to `auto`, which silently uses agy when the machine can run it.
 * That silence is the point of `auto`, but it leaves the readiness state invisible: the
 * allow-rules live in `~/.gemini/antigravity-cli/settings.json`, outside the repo, and nobody
 * remembers whether they added them. This is the one place that says so out loud, so it can
 * be run at the start of a session instead of discovered from a 19-screen flow.
 *
 * It prints one line per gate rather than a single verdict, because "not ready" has three
 * different fixes and collapsing them leaves the user to reverse-engineer which one applies.
 * `~` marks the sign-in signal, which is inferred from another tool's credential files and
 * therefore never decides anything — see agyAuthSignal.
 *
 * The flow directory is `<targetDir>/bk/`: the CLI runs before any feature exists, and the
 * allow-rule is scoped to the repo's whole `bk/` tree anyway.
 *
 * @param {string} targetDir — project root containing .claude/
 * @param {object} [opts]
 * @param {string} [opts.indent] — prefix for every printed line
 * @returns {Promise<{status: 'ok'|'warn'|'missing', engine: string|null}>}
 */
export async function reportDesignEngine(targetDir, { indent = '    ' } = {}) {
  const say = (line) => console.log(`${indent}${line}`);

  // The preflight ships with the kit, so it is read from the target dir the same way every
  // other kit file here is. A machine with no kit installed is not an error worth throwing
  // over — this command is meant to be usable before anything is set up.
  const preflightPath = join(targetDir, '.claude', 'scripts', 'agy-preflight.mjs');
  if (!existsSync(preflightPath)) {
    say(`No kit found at ${targetDir}/.claude/scripts/agy-preflight.mjs.`);
    say('Run "init" in this directory first; the design engine check needs the installed kit.');
    return { status: 'missing', engine: null };
  }

  let preflight;
  try {
    preflight = await import(pathToFileURL(preflightPath).href);
  } catch (err) {
    say(`Could not load ${preflightPath}: ${err.message}`);
    return { status: 'missing', engine: null };
  }

  const flowDir = join(targetDir, 'bk');
  const report = preflight.preflightAgyDesign({ flowDir });

  for (const item of report.checks) {
    const mark = item.ok === true ? '✓' : item.ok === false ? '✗' : '~';
    say(`${mark} ${item.name} — ${item.detail}`);
  }

  if (report.ok) {
    say('Design engine "auto" would use: agy.');
    return { status: 'ok', engine: 'agy' };
  }

  say(`Design engine "auto" would use: claude — ${report.reason}`);
  if (!report.binary) {
    say(`Install agy with ${agyInstallHint()}, then run "agy" once to authenticate.`);
  }
  if (report.remedy) say(report.remedy);
  if (report.snippet) {
    // The remedy already names the file when there is one; repeating it here would only make
    // the wall of text longer.
    if (!report.remedy) say(`Add to ${preflight.AGY_SETTINGS_PATH}:`);
    const snippet = preflight.allowRulesSnippet(preflight.requiredAllowRules(flowDir));
    for (const line of snippet.split('\n')) say(`  ${line}`);
  }
  say('Nothing is broken: the claude engine produces the same output from the same data.');
  return { status: 'warn', engine: 'claude' };
}

/**
 * Run doctor checks on an installed kit.
 *
 * Async because the design-engine check imports the installed kit's preflight module, which
 * only exists in the target directory and therefore has to be loaded dynamically.
 *
 * @param {string} targetDir — project root containing .claude/
 * @param {string} platform
 * @returns {Promise<{ passed: number, warnings: number, errors: number }>}
 */
export async function runDoctor(targetDir, platform) {
  const claudeDir = join(targetDir, '.claude');
  const versionPath = join(targetDir, '.bk-version.json');
  let passed = 0;
  let warnings = 0;
  let errors = 0;

  function check(label, fn) {
    try {
      const result = fn();
      if (result === true) {
        console.log(`  ✓ ${label}`);
        passed++;
      } else if (result === 'warn') {
        console.log(`  ⚠ ${label}`);
        warnings++;
      } else {
        console.log(`  ✗ ${label}`);
        errors++;
      }
    } catch (err) {
      console.log(`  ✗ ${label}: ${err.message}`);
      errors++;
    }
  }

  // Same tallying as `check`, for a check whose work cannot be done synchronously.
  async function checkAsync(label, fn) {
    try {
      const result = await fn();
      if (result === true) {
        console.log(`  ✓ ${label}`);
        passed++;
      } else if (result === 'warn') {
        console.log(`  ⚠ ${label}`);
        warnings++;
      } else {
        console.log(`  ✗ ${label}`);
        errors++;
      }
    } catch (err) {
      console.log(`  ✗ ${label}: ${err.message}`);
      errors++;
    }
  }

  // 1. .claude/ exists
  check('.claude/ directory exists', () => existsSync(claudeDir));

  // 2. .bk-version.json exists and is valid
  check('.bk-version.json exists and valid', () => {
    if (!existsSync(versionPath)) return false;
    const data = JSON.parse(readFileSync(versionPath, 'utf8'));
    return !!(data.version && data.platform && data.files);
  });

  // 3. platform-context.json exists and valid
  check('platform-context.json valid', () => {
    const ctxPath = join(claudeDir, 'platform-context.json');
    if (!existsSync(ctxPath)) return false;
    const data = JSON.parse(readFileSync(ctxPath, 'utf8'));
    return data.platform === platform;
  });

  // 4. settings.json exists and valid (CR-P1-26)
  check('settings.json valid', () => {
    const settingsPath = join(claudeDir, 'settings.json');
    if (!existsSync(settingsPath)) return false;
    const data = JSON.parse(readFileSync(settingsPath, 'utf8'));
    // Validate required sections
    if (!data.hooks) return 'warn';
    // Check hooks reference existing files
    let missingHooks = 0;
    for (const entries of Object.values(data.hooks)) {
      for (const group of entries) {
        for (const hook of (group.hooks || [])) {
          const cmd = hook.command || '';
          // Extract hook filename from patterns like:
          // bash -c 'node "$(git rev-parse ...)/.claude/hooks/foo.cjs"'
          // node .claude/hooks/foo.cjs
          const match = cmd.match(/\.claude\/hooks\/([^\s"']+)/);
          if (match) {
            const hookPath = join('hooks', match[1]);
            if (!existsSync(join(claudeDir, hookPath))) {
              missingHooks++;
            }
          }
        }
      }
    }
    if (missingHooks > 0) {
      console.log(`    ${missingHooks} hook file(s) referenced but missing`);
      return false;
    }
    // Validate MCP servers have command or note field
    if (data.mcpServers) {
      for (const [name, config] of Object.entries(data.mcpServers)) {
        if (!config.command && !config.url && !config.note) {
          console.log(`    MCP server "${name}" has no command, url, or note`);
          return 'warn';
        }
      }
    }
    return true;
  });

  // 5. Core directories exist
  for (const dir of ['agents', 'skills', 'hooks', 'rules']) {
    check(`${dir}/ directory exists`, () => existsSync(join(claudeDir, dir)));
  }

  // 6. Check files from .bk-version.json are present AND still match their recorded hash.
  //    Presence alone used to be the whole check, which made a locally patched kit file
  //    indistinguishable from an untouched one — see lib/kit-drift.mjs.
  if (existsSync(versionPath)) {
    const versionData = JSON.parse(readFileSync(versionPath, 'utf8'));
    const files = versionData.files || {};
    const drift = detectDrift(claudeDir, files, { ignore: readDoctorIgnore(targetDir) });

    check(`All ${drift.total} kit files present`, () => {
      if (drift.missing.length === 0) return true;
      console.log(`    ${drift.missing.length} file(s) missing`);
      for (const line of formatDriftList(drift.missing)) console.log(`      ${line}`);
      return false;
    });

    // Always a warning, never an error: customising the kit is legitimate, and `bk update`
    // already protects local edits by reporting a conflict instead of overwriting them. The
    // point of this line is that the user knows the edits are there.
    // The label states the verdict rather than the workload, because `check` prints it after
    // the detail lines: "416 kit files match recorded hashes" under a list of what does not
    // match reads as a contradiction.
    const hashLabel = drift.drifted.length > 0
      ? `${drift.drifted.length} of ${drift.checked} kit files modified locally`
      : `${drift.checked} kit files match recorded hashes`;
    check(hashLabel, () => {
      if (drift.unreadable.length > 0) {
        console.log(`    ${drift.unreadable.length} file(s) could not be read:`);
        for (const line of formatDriftList(drift.unreadable)) console.log(`      ${line}`);
      }
      if (drift.drifted.length === 0) return drift.unreadable.length > 0 ? 'warn' : true;

      console.log(`    ${drift.drifted.length} file(s) modified locally since install:`);
      for (const line of formatDriftList(drift.drifted)) console.log(`      ${line}`);
      console.log('    Local edits are fine — "bk update" keeps them and reports a conflict.');
      console.log('    To take the package version of changed files instead:');
      console.log(`      bk update --kit ${platform} --conflict take`);
      console.log('    To silence deliberate customisations, list them under "doctorIgnore"');
      console.log('    in .claude/.bk.json.');
      return 'warn';
    });
  }

  // 7. Optional tool check: Antigravity CLI, which backs bk-gemini-reviewer since 0.2.0.
  //    Optional by design — /bk-review --engine claude needs no external CLI — so a missing
  //    binary is a warning with a way forward, not an error.
  //    Scoped to code review in the label: check 9 below asks a different and larger question
  //    about the same binary, and two checks that read as duplicates teach the user to skip
  //    both.
  check('agy CLI available (code review, optional)', () => {
    if (hasCommand('agy')) return true;
    console.log('    Optional: Antigravity CLI ("agy") not found, so bk-gemini-reviewer cannot run.');
    console.log(`    Install it with ${agyInstallHint()}, then run "agy" once to authenticate.`);
    console.log('    Or skip it — "/bk-review --engine claude" works with no setup.');
    return 'warn';
  });

  // 8. Figma access, which backs the design extraction trio (design-validator,
  //    design-spec-writer, design-asset-exporter). Both engines read Figma over its REST
  //    API, so the only requirement is a token — there is no MCP server to check. Design
  //    work is optional, so a missing token is a warning, never an error.
  check('Figma token available (design extraction, optional)', () => {
    const names = ['FIGMA_API_KEY', 'FIGMA_ACCESS_TOKEN', 'FIGMA_TOKEN'];
    const fromEnv = names.find((name) => process.env[name]);
    if (fromEnv) {
      console.log(`    Found in the environment (${fromEnv}).`);
      return true;
    }

    // The same files figma-rest.mjs reads, in the same order. Only presence is checked —
    // the token itself is never read here, and never printed anywhere.
    const candidates = [
      join(homedir(), '.config', 'beer-kit', 'figma.env'),
      join(targetDir, '.env')
    ];
    const found = candidates.find((file) => {
      if (!existsSync(file)) return false;
      try {
        return names.some((name) => new RegExp(`^\\s*(export\\s+)?${name}\\s*=`, 'm')
          .test(readFileSync(file, 'utf8')));
      } catch (_) {
        return false;
      }
    });

    if (found) {
      console.log(`    Found in ${found.replace(homedir(), '~')}.`);
      return true;
    }

    console.log('    No Figma token found. Design extraction cannot read Figma without one.');
    console.log('    Create one at https://www.figma.com/developers/api#access-tokens, then:');
    console.log('      printf \'FIGMA_API_KEY=%s\\n\' "$KEY" > ~/.config/beer-kit/figma.env');
    console.log('    Skip this if the project has no Figma designs.');
    return 'warn';
  });

  // 9. Design engine readiness. Sits next to the Figma token check because they answer two
  //    halves of the same question — the token says whether Figma can be read at all, this
  //    says which engine will read it. Never an error: a machine without agy runs the claude
  //    engine and produces the same files.
  await checkAsync('design engine readiness (agy vs claude)', async () => {
    const result = await reportDesignEngine(targetDir);
    return result.status === 'ok' ? true : 'warn';
  });

  // 10. Per-machine session state kept out of git — see lib/session-state-gitignore.mjs for the
  //     field case (X-Game-Pro, commit 75e97db) that no check here caught. Tracked state is an
  //     error: it is already in history, it conflicts on the next pull, and on another machine
  //     it describes a session that is not there. Missing ignore entries are a warning: nothing
  //     is wrong yet, but a broad `git add` is one step away. Skipped entirely outside a git
  //     repository — there is nothing to get wrong there.
  const tracked = trackedSessionState(targetDir);
  if (tracked) {
    const missing = missingIgnoreEntries(targetDir);
    const label = tracked.files.length > 0
      ? `${tracked.files.length} session-state file(s) tracked by git`
      : 'session state ignored by git';
    check(label, () => {
      if (tracked.files.length === 0 && missing.length === 0) return true;
      if (tracked.files.length > 0) {
        console.log('    Per-machine state is committed; it changes every tool call and does not merge:');
        for (const line of formatDriftList(tracked.files)) console.log(`      ${line}`);
      }
      if (missing.length > 0) {
        console.log('    Not ignored, so a broad `git add` will commit them:');
        for (const e of missing) console.log(`      ${e}`);
      }
      console.log('    Fix, from this directory:');
      if (missing.length > 0) {
        console.log(`      ${appendIgnoreCommand(missing)}`);
        console.log('      (or "bk update", which writes the same entries)');
      }
      if (tracked.files.length > 0) {
        console.log(`      ${untrackCommand(tracked.pathspecs)}`);
        if (missing.length > 0) console.log('      git add .gitignore');
        console.log('      git commit -m "chore: stop tracking beer-kit session state"');
        console.log('    The files stay on disk here. Other clones drop their copies on the next pull;');
        console.log('    the kit re-derives the phase from bk/dev/{feature}/.plan-state.json.');
        return false;
      }
      return 'warn';
    });
  }

  return { passed, warnings, errors };
}

/**
 * Register the doctor command with commander.
 * @param {import('commander').Command} program
 */
export function registerDoctor(program) {
  const command = program
    .command('doctor')
    .description('Validate .claude/ kit installation')
    .option('--target <dir>', 'Target project directory', '.')
    .option('--design-engine', 'Only report which design engine "auto" would pick here')
    .option('--hook-perf', 'Only measure what this kit\'s hooks cost per tool call')
    .option('--runs <n>', 'Runs per hook for --hook-perf (median is reported)', '3');

  addKitOption(command)
    .action(async (opts) => {
      const targetDir = resolve(opts.target);

      // --hook-perf measures; it never judges. Like --design-engine it runs standalone and never
      // exits non-zero — a slow kit is a fact about the machine, not a broken install, and
      // failing the exit code would break any script that graphs the number over time.
      if (opts.hookPerf) {
        const runs = Math.max(1, Number.parseInt(opts.runs, 10) || 3);
        console.log(`Hook cost for the kit in ${targetDir} (${runs} run(s) per hook):\n`);
        reportHookPerf(targetDir, { runs });
        return;
      }

      // --design-engine answers a machine question, not an installation question, so it runs
      // on its own and never fails the exit code: a machine that will simply use the claude
      // engine is a working machine, and exiting 1 on it would be a lie that breaks scripts.
      if (opts.designEngine) {
        console.log(`Design engine readiness in ${targetDir}:\n`);
        const result = await reportDesignEngine(targetDir, { indent: '  ' });
        if (result.status !== 'ok') {
          console.log('\nNote: this is information, not a broken install.');
        }
        return;
      }

      // Resolved only here: --design-engine and --hook-perf above ask machine questions that
      // hold for any kit, so requiring a resolvable platform for them would refuse to answer a
      // question that does not depend on one.
      const platform = resolveKitOrExit({
        packageRoot: packageRootFrom(import.meta.dirname),
        targetDir,
        explicit: opts.kit,
      });

      console.log(`Checking ${platform} kit in ${targetDir}...\n`);

      const result = await runDoctor(targetDir, platform);

      console.log(`\n${result.passed} passed, ${result.warnings} warnings, ${result.errors} errors`);
      if (result.errors > 0) process.exit(1);
    });
}
