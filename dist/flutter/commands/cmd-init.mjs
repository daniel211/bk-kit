/**
 * cmd-init.mjs — Initialize a project with the beer-kit platform kit.
 *
 * Copies pre-built kit/ from the npm package into the target project's .claude/ directory.
 * Writes .bk-version.json for update tracking.
 */

import { existsSync, writeFileSync, readFileSync, unlinkSync, rmSync, readdirSync } from 'node:fs';
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

      printVersionControlNotice(targetDir);
    });
}

/**
 * Tell the user exactly what init put in their repository and let them decide
 * whether to track it. init creates three entries a clean working tree will show
 * as untracked, and silently leaving the repo in that state is unhelpful:
 *
 *   .claude/           the kit itself — commit it to share one version across a team
 *   .bk-version.json   install manifest used by `update` to detect local edits
 *   .bk-metrics/       per-developer runtime telemetry, never worth committing
 *
 * Only prints inside a git repository, and stays quiet about entries the project
 * already ignores.
 */
function printVersionControlNotice(targetDir) {
  if (!existsSync(join(targetDir, '.git'))) return;

  const entries = ['.claude/', '.bk-version.json', '.bk-metrics/'];
  let ignored = '';
  try {
    ignored = readFileSync(join(targetDir, '.gitignore'), 'utf8');
  } catch {
    // No .gitignore — nothing is ignored yet.
  }
  const ignoredSet = new Set(
    ignored.split('\n').map((l) => l.trim().replace(/\/$/, '')).filter(Boolean),
  );
  const untracked = entries.filter((e) => !ignoredSet.has(e.replace(/\/$/, '')));
  if (untracked.length === 0) return;

  console.log('\nVersion control — this created files git will show as untracked:');
  console.log('  .claude/          the kit; commit it to pin one version for the team');
  console.log('  .bk-version.json  install manifest, read by `update` to spot local edits');
  console.log('  .bk-metrics/      per-developer runtime telemetry — do not commit');
  console.log('\nCommit them, or ignore them by adding to .gitignore:');
  for (const e of untracked) console.log(`  ${e}`);
}
