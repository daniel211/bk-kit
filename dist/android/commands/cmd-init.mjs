/**
 * cmd-init.mjs — Initialize a project with the beer-kit platform kit.
 *
 * Copies pre-built kit/ from the npm package into the target project's .claude/ directory.
 * Writes .bk-version.json for update tracking.
 */

import { existsSync, writeFileSync, readFileSync, appendFileSync, unlinkSync, rmSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { hashAllFiles } from '../lib/hash-tracker.mjs';
import { runDoctor } from './cmd-doctor.mjs';
import { copyDirFiltered } from '../lib/file-utils.mjs';
import { mergeSettings } from '../lib/settings-merger.mjs';

/**
 * Register the init command with commander.
 * @param {import('commander').Command} program
 * @param {string} platform
 */
export function registerInit(program, platform) {
  program
    .command('init')
    .description(`Initialize .claude/ with ${platform} development kit`)
    .option('--target <dir>', 'Target project directory', '.')
    .option('--force', 'Overwrite existing .claude/ directory')
    .option('--gitignore', "Add the kit's per-machine state files to .gitignore")
    // Async because runDoctor is: its design-engine check dynamically imports the kit that
    // was just written into the target directory.
    .action(async (opts) => {
      const targetDir = resolve(opts.target);
      const claudeDir = join(targetDir, '.claude');

      // Check if .claude/ already exists
      if (existsSync(claudeDir) && !opts.force) {
        console.error(`Error: ${claudeDir} already exists. Use --force to overwrite.`);
        process.exit(1);
      }

      // Resolve kit/ directory (relative to this CLI package)
      const kitDir = resolve(import.meta.dirname, '../kit');
      if (!existsSync(kitDir)) {
        console.error('Error: kit/ directory not found in package. Package may be corrupted.');
        process.exit(1);
      }

      // Read kit-manifest for metadata
      const kitManifestPath = resolve(import.meta.dirname, '../kit-manifest.json');
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

      // Copy cli/ → .claude/cli/ (CLI binaries like bk-health, bk-harness-ci)
      const packageRoot = resolve(import.meta.dirname, '..');
      const cliDir = join(packageRoot, 'cli');
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

      // Run doctor
      console.log('Running doctor check...');
      const doctorResult = await runDoctor(targetDir, platform);

      if (doctorResult.errors === 0) {
        console.log('\n✓ Kit initialized successfully!');
      } else {
        console.log(`\n⚠ Kit initialized with ${doctorResult.errors} issue(s). Run "bk-${platform} doctor" for details.`);
      }

      let wroteGitignore = false;
      if (opts.gitignore) {
        const added = writeGitignoreEntries(targetDir);
        wroteGitignore = true;
        if (added.length > 0) {
          console.log(`\n  ✓ Added ${added.length} entr${added.length === 1 ? 'y' : 'ies'} to .gitignore`);
        } else {
          console.log('\n  ✓ .gitignore already covers the kit\'s per-machine state');
        }
      }

      printVersionControlNotice(targetDir, wroteGitignore);
    });
}

/**
 * Paths the kit writes that must never be committed.
 *
 * Every one is a record of *this machine's* session, not of the work:
 *
 *   .workflow-state.json  FSM phase plus session-scoped agent ids — `dev_agent_id` is
 *                         resumable only in the session that spawned it, so the file is
 *                         actively misleading on a second machine. It also changes on
 *                         nearly every tool call, and merging its counters and appended
 *                         arrays is exactly what git cannot do.
 *   checkpoints/          snapshots of the above
 *   handoff/              context-reset handoff notes, written per session
 *   .statusline-cache.json, .retry-state.json   live counters
 *   .bk-metrics/          per-developer runtime telemetry
 *
 * What carries work between machines is the plan directory — `bk/dev/{feature}/` with its
 * `.plan-state.json` — which records what is *done* rather than which session did it, and
 * from which the phase is re-derived on the other machine. That is what belongs in git.
 */
export const NEVER_COMMIT = [
  'bk/dev/shared/.workflow-state.json',
  'bk/dev/shared/.workflow-state.json.*',
  'bk/dev/shared/checkpoints/',
  'bk/dev/shared/handoff/',
  'bk/dev/shared/.statusline-cache.json',
  'bk/dev/shared/.retry-state.json',
  '.bk-metrics/',
];

const GITIGNORE_HEADER =
  '# beer-kit — per-machine session state; the plans in bk/dev/{feature}/ are committed';

/**
 * Read the project's .gitignore as a set of trimmed, de-slashed entries.
 * @param {string} targetDir
 * @returns {{ text: string, entries: Set<string> }}
 */
function readGitignore(targetDir) {
  let text = '';
  try {
    text = readFileSync(join(targetDir, '.gitignore'), 'utf8');
  } catch {
    // No .gitignore — nothing is ignored yet.
  }
  const entries = new Set(
    text.split('\n').map((l) => l.trim().replace(/\/$/, '')).filter(Boolean),
  );
  return { text, entries };
}

/**
 * Append the missing never-commit entries to .gitignore.
 *
 * Appends only what is absent, so running it twice adds nothing the second time and a user
 * who ignores more than the kit asks for keeps their own rules.
 *
 * @param {string} targetDir
 * @returns {string[]} The entries actually written
 */
export function writeGitignoreEntries(targetDir) {
  const { text, entries } = readGitignore(targetDir);
  const missing = NEVER_COMMIT.filter((e) => !entries.has(e.replace(/\/$/, '')));
  if (missing.length === 0) return [];

  const prefix = text.length === 0 || text.endsWith('\n') ? '' : '\n';
  const block = `${prefix}\n${GITIGNORE_HEADER}\n${missing.join('\n')}\n`;
  appendFileSync(join(targetDir, '.gitignore'), block, 'utf8');
  return missing;
}

/**
 * Tell the user what init put in their repository and what to do with it.
 *
 * Silently leaving a repo full of untracked kit files is unhelpful, and the split is not
 * obvious: the kit and the plans are shared, the session state is not. Only prints inside a
 * git repository.
 *
 * @param {string} targetDir
 * @param {boolean} wroteGitignore - Whether --gitignore already handled the ignore list
 */
function printVersionControlNotice(targetDir, wroteGitignore) {
  if (!existsSync(join(targetDir, '.git'))) return;

  console.log('\nVersion control — what to do with what this created:');
  console.log('  commit  .claude/          the kit; pins one version for the team');
  console.log('  commit  .bk-version.json  install manifest, read by `update` to spot local edits');
  console.log('  commit  bk/dev/{feature}/ plans and .plan-state.json — this is what moves');
  console.log('                            work between machines and between people');
  console.log('  ignore  session state     per-machine, changes every tool call, does not merge');

  if (wroteGitignore) return;

  const { entries } = readGitignore(targetDir);
  const missing = NEVER_COMMIT.filter((e) => !entries.has(e.replace(/\/$/, '')));
  if (missing.length === 0) return;

  console.log('\nAdd to .gitignore (or re-run init with --gitignore to write them):');
  for (const e of missing) console.log(`  ${e}`);
}
