/**
 * cmd-init.mjs — Initialize a project with the beer-kit platform kit.
 *
 * Copies pre-built kit/ from the npm package into the target project's .claude/ directory.
 * Writes .bk-version.json for update tracking.
 */

import { existsSync, writeFileSync, readFileSync, unlinkSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { hashAllFiles } from '../lib/hash-tracker.mjs';
import { runDoctor } from './cmd-doctor.mjs';
import { copyDirFiltered } from '../lib/file-utils.mjs';
import { mergeSettings } from '../lib/settings-merger.mjs';
import { kitLayout, packageRootFrom } from '../lib/package-layout.mjs';
import { addKitOption, resolveKitOrExit } from '../lib/kit-resolver.mjs';
import { applyModeToInstalledAgents, readSubagentContextMode } from '../lib/subagent-context-mode.mjs';
import { readModelOverrides, unknownOverrideAgents } from '../lib/agent-model-override.mjs';
import { parseModelsOption, resolveModelPreset, persistModelPreset, recordPristineConfigHash, DEFAULT_PRESET } from '../lib/init-model-preset.mjs';
import {
  gitPrefix, writeGitignoreEntries,
} from '../lib/session-state-gitignore.mjs';
import { applyFrameworkToInstalledContext, resolveFrameworkOption } from '../lib/framework-detector.mjs';

// Re-exported: callers and tests have always imported the list from here.
export { NEVER_COMMIT, writeGitignoreEntries } from '../lib/session-state-gitignore.mjs';

/**
 * Register the init command with commander.
 * @param {import('commander').Command} program
 */
export function registerInit(program) {
  const command = program
    .command('init')
    .description('Initialize .claude/ with a platform development kit')
    .option('--target <dir>', 'Target project directory', '.')
    .option('--force', 'Overwrite existing .claude/ directory')
    // Both spellings: --gitignore predates the default and stays valid in scripts (it also
    // forces the write outside a git repository); --no-gitignore is the opt-out.
    .option('--gitignore', "Add the kit's per-machine state files to .gitignore (default in a git repo)")
    .option('--no-gitignore', "Do not touch .gitignore")
    .option('--models <preset>', 'Agent model preset: quality | balanced | economy (asks when interactive)')
    .option('--framework <id>', 'python: fastapi | django | generic; web: next | vite | generic (default: detected)')
    .option('--yes', 'Skip prompts and use defaults');

  addKitOption(command)
    // Async because runDoctor is: its design-engine check dynamically imports the kit that
    // was just written into the target directory.
    .action(async (opts) => {
      // Rejected before anything is read or written.
      let explicitPreset;
      try {
        explicitPreset = parseModelsOption(opts.models);
      } catch (err) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
      const targetDir = resolve(opts.target);
      const claudeDir = join(targetDir, '.claude');

      // init never reads .bk-version.json: on a re-init the file records what the LAST install
      // chose, and taking that as the answer would make a deliberate `--kit` switch impossible
      // to express as anything but deleting the file first.
      const pkgRoot = packageRootFrom(import.meta.dirname);
      const platform = resolveKitOrExit({
        packageRoot: pkgRoot,
        targetDir,
        explicit: opts.kit,
        useRecorded: false,
      });
      const layout = kitLayout(pkgRoot, platform);

      // Check if .claude/ already exists
      if (existsSync(claudeDir) && !opts.force) {
        console.error(`Error: ${claudeDir} already exists. Use --force to overwrite.`);
        process.exit(1);
      }

      const kitDir = layout.kitDir;
      if (!existsSync(kitDir)) {
        console.error(`Error: kits/${platform}/kit not found in package. Package may be corrupted.`);
        process.exit(1);
      }

      // --framework is checked against the kit's own `frameworks` map, still before any write.
      let forcedFramework;
      try {
        let kitCtx = null;
        try { kitCtx = JSON.parse(readFileSync(join(kitDir, 'platform-context.json'), 'utf8')); } catch { /* validated below */ }
        forcedFramework = resolveFrameworkOption(platform, kitCtx, opts.framework);
      } catch (err) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }

      // Read kit-manifest for metadata
      const kitManifestPath = layout.kitManifestPath;
      const kitManifest = existsSync(kitManifestPath)
        ? JSON.parse(readFileSync(kitManifestPath, 'utf8'))
        : { version: '1.0.0', platform };

      console.log(`Initializing ${platform} kit in ${claudeDir}...\n`);

      // --force: clean stale files from previous install
      if (opts.force) {
        // Always clean hooks/ and hooks/lib/ directories to prevent stale module errors.
        // Old hooks that reference renamed/removed lib modules cause MODULE_NOT_FOUND.
        const hooksDir = join(claudeDir, 'hooks');
        if (existsSync(hooksDir)) {
          try {
            // Clean hook .cjs files (not subdirs like .logs/)
            for (const entry of readdirSync(hooksDir, { withFileTypes: true })) {
              if (entry.isFile() && entry.name.endsWith('.cjs')) {
                unlinkSync(join(hooksDir, entry.name));
              }
            }
            // Clean lib/ completely — prevents stale modules (ck-config-utils vs bk-config-utils)
            const libDir = join(hooksDir, 'lib');
            if (existsSync(libDir)) {
              for (const entry of readdirSync(libDir, { withFileTypes: true })) {
                if (entry.isFile() && entry.name.endsWith('.cjs')) {
                  unlinkSync(join(libDir, entry.name));
                }
              }
            }
            console.log('  ✓ Cleaned stale hooks and lib/');
          } catch { /* best-effort hook cleanup */ }
        }

        // Also clean tracked files from old .bk-version.json
        const oldVersionPath = join(targetDir, '.bk-version.json');
        if (existsSync(oldVersionPath)) {
          try {
            const oldVersion = JSON.parse(readFileSync(oldVersionPath, 'utf8'));
            const oldFiles = oldVersion.files || {};
            const kitHashes = hashAllFiles(kitDir);
            // Remove files tracked in old version that no longer exist in new kit
            for (const relPath of Object.keys(oldFiles)) {
              if (!kitHashes[relPath]) {
                const stalePath = join(claudeDir, relPath);
                if (existsSync(stalePath)) {
                  unlinkSync(stalePath);
                  console.log(`  ✗ Removed stale: ${relPath}`);
                }
              }
            }
          } catch { /* best-effort stale cleanup */ }
        }
      }

      // Copy kit → .claude/ (excluding settings.json — handled separately via merge)
      copyDirFiltered(kitDir, claudeDir, ['settings.json']);

      // python / web: pick the framework variant and fold its commands into the installed
      // platform-context.json (user-owned from here on; `bk update` never rewrites it). Before
      // hashing, so .bk-version.json records the file as written. Mobile kits: null, no output.
      const fw = applyFrameworkToInstalledContext({
        ctxPath: join(claudeDir, 'platform-context.json'),
        platform,
        projectRoot: targetDir,
        forced: forcedFramework,
      });
      if (fw) console.log(`  ✓ Framework: ${fw.line}`);

      // Model preset first: it writes `.bk.json` models, which the block below then applies.
      const preset = await resolveModelPreset({ explicit: explicitPreset, yes: opts.yes });
      const presetAgents = persistModelPreset({ targetDir, claudeDir, preset });
      if (preset !== DEFAULT_PRESET) {
        console.log(`  ✓ Agent models: ${preset} (${presetAgents} agent(s)) — change anytime with \`bk models\``);
      }

      // `.bk.json` subagents.fullContext: kit agents without omitClaudeMd. Read after the copy,
      // so it is the .bk.json this install leaves behind, and applied before hashing, so
      // .bk-version.json records what is on disk — the hash `update` computes for the same mode
      // (lib/subagent-context-mode.mjs). Today that is always lean: init refuses an existing
      // .claude/, and --force replaces .bk.json with the template. `bk update` applies a toggle.
      const contextMode = readSubagentContextMode(targetDir);
      const { overrides: modelOverrides, warnings: modelWarnings } = readModelOverrides(targetDir, [kitDir]);
      const modeChanged = applyModeToInstalledAgents(claudeDir, contextMode, modelOverrides);
      for (const w of modelWarnings) console.log(`  ⚠ ${w}`);
      const unknownModelAgents = unknownOverrideAgents(modelOverrides, claudeDir);
      if (unknownModelAgents.length > 0) console.log(`  ⚠ .bk.json models names no installed kit agent: ${unknownModelAgents.join(', ')}`);
      if (modeChanged.length > 0) {
        console.log(contextMode === 'full'
          ? `  ✓ Subagent context: full — omitClaudeMd removed from ${modeChanged.length} kit agent(s)`
          : `  ✓ Agent models: ${modeChanged.length} kit agent(s) rewritten from .bk.json models`);
      }

      // Copy cli/ → .claude/cli/ (CLI binaries like bk-health, bk-harness-ci)
      const cliDir = join(layout.packageRoot, 'cli');
      if (existsSync(cliDir)) {
        copyDirFiltered(cliDir, join(claudeDir, 'cli'), []);
      }

      // Merge settings.json (preserve user config)
      const kitSettingsPath = join(kitDir, 'settings.json');
      const existingSettingsPath = join(claudeDir, 'settings.json');
      if (existsSync(kitSettingsPath)) {
        const kitSettings = JSON.parse(readFileSync(kitSettingsPath, 'utf8'));
        if (existsSync(existingSettingsPath) && !opts.force) {
          try {
            const existingSettings = JSON.parse(readFileSync(existingSettingsPath, 'utf8'));
            const { merged, summary } = mergeSettings(existingSettings, kitSettings);
            writeFileSync(existingSettingsPath, JSON.stringify(merged, null, 2) + '\n', 'utf8');
            if (summary.length > 0) {
              console.log('  Settings merge:');
              summary.forEach(s => console.log(`    ${s}`));
            }
          } catch {
            // Existing settings.json is invalid — overwrite
            writeFileSync(existingSettingsPath, JSON.stringify(kitSettings, null, 2) + '\n', 'utf8');
            console.log('  ⚠ Existing settings.json was invalid — replaced with kit defaults');
          }
        } else {
          writeFileSync(existingSettingsPath, JSON.stringify(kitSettings, null, 2) + '\n', 'utf8');
        }
      }

      // Compute file hashes for .bk-version.json
      const fileHashes = hashAllFiles(claudeDir);
      if (preset !== DEFAULT_PRESET) recordPristineConfigHash(fileHashes, kitDir);

      // Write .bk-version.json at project root
      const versionFile = {
        version: kitManifest.version,
        platform,
        installedAt: new Date().toISOString(),
        files: fileHashes,
      };
      writeFileSync(
        join(targetDir, '.bk-version.json'),
        JSON.stringify(versionFile, null, 2) + '\n',
        'utf8',
      );

      // Print summary
      const fileCount = Object.keys(fileHashes).length;
      console.log(`  ✓ Copied ${fileCount} files to .claude/`);
      console.log(`  ✓ Written .bk-version.json`);
      console.log(`  ✓ Platform: ${platform}`);
      console.log(`  ✓ Version: ${kitManifest.version}\n`);

      // Ignore the session state before doctor runs, so doctor reports the result rather than
      // the moment just before it.
      applyGitignoreDefault(targetDir, opts.gitignore);

      // Run doctor
      console.log('Running doctor check...');
      const doctorResult = await runDoctor(targetDir, platform);

      if (doctorResult.errors === 0) {
        console.log('\n✓ Kit initialized successfully!');
      } else {
        console.log(`\n⚠ Kit initialized with ${doctorResult.errors} issue(s). Run "bk doctor" for details.`);
      }

      printVersionControlNotice(targetDir);
    });
}

/**
 * Write the never-commit entries to .gitignore — by default, in a git repository.
 *
 * Until 0.10.1 this needed `--gitignore` and the default was a printed notice. The notice did
 * not work: X-Game-Pro has no .gitignore at all, its kit-install commit already tracked
 * .workflow-state.json and .bk-metrics/, and a later "commit this task and the bk state"
 * added the .bak, the retry state and five checkpoints. A list of files that must never be
 * committed is not advice to print once; it is setup.
 *
 * Outside a git repository nothing is written unless `--gitignore` asks for it explicitly: a
 * stray .gitignore in a directory that is not under git is clutter, and `update` or a re-init
 * writes it once the project is. `--no-gitignore` opts out everywhere.
 *
 * @param {string} targetDir
 * @param {boolean|undefined} flag - true for --gitignore, false for --no-gitignore, undefined for neither
 * @returns {{ status: 'written'|'covered'|'skipped'|'not-git', added: string[] }}
 */
export function applyGitignoreDefault(targetDir, flag) {
  if (flag === false) return { status: 'skipped', added: [] };
  if (flag !== true && gitPrefix(targetDir) === null) return { status: 'not-git', added: [] };

  const added = writeGitignoreEntries(targetDir);
  if (added.length > 0) {
    console.log(`  ✓ Added ${added.length} session-state entr${added.length === 1 ? 'y' : 'ies'} to .gitignore (--no-gitignore to skip)`);
    return { status: 'written', added };
  }
  console.log('  ✓ .gitignore already covers the kit\'s per-machine state');
  return { status: 'covered', added };
}

/**
 * Tell the user what init put in their repository and what to do with it.
 *
 * Silently leaving a repo full of untracked kit files is unhelpful, and the split is not
 * obvious: the kit and the plans are shared, the session state is not. Only prints inside a
 * git repository.
 *
 * @param {string} targetDir
 */
function printVersionControlNotice(targetDir) {
  if (gitPrefix(targetDir) === null) return;

  console.log('\nVersion control — what to do with what this created:');
  console.log('  commit  .claude/          the kit; pins one version for the team');
  console.log('  commit  .bk-version.json  install manifest, read by `update` to spot local edits');
  console.log('  commit  bk/dev/{feature}/ plans and .plan-state.json — this is what moves');
  console.log('                            work between machines and between people');
  console.log('  ignore  session state     per-machine, changes every tool call, does not merge');
  // Whether it IS ignored is doctor's line above ("session state ignored by git"), which also
  // prints the fix after --no-gitignore; repeating the list here only doubled it.
}
