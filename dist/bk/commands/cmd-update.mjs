/**
 * cmd-update.mjs — Sync installed .claude/ kit with latest package version.
 *
 * Compares installed file hashes against package kit hashes.
 * Auto-updates safe files, prompts for conflicts.
 */

import { existsSync, readFileSync, cpSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { hashFile } from '../lib/hash-tracker.mjs';
import { buildPackageInventory, kitLayout, packageRootFrom, sourceFor } from '../lib/package-layout.mjs';
import { addKitOption, resolveKitOrExit } from '../lib/kit-resolver.mjs';

/**
 * Classify a file's change state by comparing 3 hashes.
 *
 * @param {string|undefined} kitHash — hash in current package's kit-manifest
 * @param {string|undefined} installHash — hash from .bk-version.json (what was installed)
 * @param {string|undefined} currentHash — hash of file currently on disk
 * @returns {"new"|"unchanged"|"safe_update"|"conflict"|"deleted"}
 */
function classifyChange(kitHash, installHash, currentHash) {
  if (!installHash) return 'new';
  if (!kitHash) return 'deleted';
  if (!currentHash && installHash) return 'user_deleted';
  if (kitHash === installHash) return 'unchanged';
  if (currentHash === installHash) return 'safe_update';
  return 'conflict';
}

/**
 * Resolve one conflict, asking the user only when someone is there to ask.
 *
 * A closed stdin used to end the update where it stood: `rl.question` never fires, the
 * process exits, and the kit is left half-updated with .bk-version.json still naming the
 * old version. Non-interactive runs — CI, scripts, an agent driving the CLI — are exactly
 * where this command gets used, so they now resolve to `keep`, which changes nothing the
 * user wrote.
 *
 * @param {string} filePath — relative path of conflicting file
 * @param {"prompt"|"keep"|"take"} strategy
 * @returns {Promise<"keep"|"take"|"skip_all">}
 */
async function promptConflict(filePath, strategy = 'prompt') {
  console.log(`\n  ⚠ Conflict: ${filePath}`);
  console.log('    Package updated this file, but you also modified it locally.');

  if (strategy !== 'prompt') {
    console.log(`    --conflict ${strategy}: ${strategy === 'take' ? 'taking the package version' : 'keeping yours'}.`);
    return strategy;
  }
  if (!process.stdin.isTTY) {
    console.log('    Not a terminal, so nothing can be asked: keeping yours.');
    console.log('    Re-run with --conflict take to accept package versions instead.');
    return 'keep';
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    console.log('    [k] Keep yours  [t] Take package version  [s] Skip all conflicts');
    // A closed stdin resolves rather than hanging — see above.
    rl.once('close', () => resolve('keep'));
    rl.question('    Choice: ', (answer) => {
      rl.close();
      const choice = (answer || '').trim().toLowerCase();
      if (choice === 't') resolve('take');
      else if (choice === 's') resolve('skip_all');
      else resolve('keep');
    });
  });
}

/**
 * Register the update command with commander.
 * @param {import('commander').Command} program
 */
export function registerUpdate(program) {
  const command = program
    .command('update')
    .description('Update .claude/ kit to latest package version')
    .option('--target <dir>', 'Target project directory', '.')
    .option('--conflict <strategy>', 'How to resolve conflicts without asking: keep | take', 'prompt');

  addKitOption(command)
    .action(async (opts) => {
      if (!['prompt', 'keep', 'take'].includes(opts.conflict)) {
        console.error(`Error: --conflict must be one of: prompt, keep, take (got "${opts.conflict}")`);
        process.exit(1);
      }

      const targetDir = resolve(opts.target);
      const claudeDir = join(targetDir, '.claude');
      const versionPath = join(targetDir, '.bk-version.json');

      // Validate installation exists
      if (!existsSync(versionPath)) {
        console.error('Error: .bk-version.json not found. Run "init" first.');
        process.exit(1);
      }

      // Read installed state
      const versionData = JSON.parse(readFileSync(versionPath, 'utf8'));
      const installedFiles = versionData.files || {};

      // Which kit to update is normally not a choice: .bk-version.json records what init put
      // here, and updating a project with a different platform's kit would be a rewrite, not an
      // update. --kit is the escape hatch for a deliberate switch.
      const pkgRoot = packageRootFrom(import.meta.dirname);
      const platform = resolveKitOrExit({ packageRoot: pkgRoot, targetDir, explicit: opts.kit });
      const { kitDir, packageRoot, kitManifestPath } = kitLayout(pkgRoot, platform);

      if (!existsSync(kitManifestPath)) {
        console.error(`Error: kits/${platform}/kit-manifest.json not found in package.`);
        process.exit(1);
      }
      const kitManifest = JSON.parse(readFileSync(kitManifestPath, 'utf8'));

      // `init` installs two trees into .claude/: the kit itself, and the developer CLIs
      // from the package's cli/ directory. kit-manifest.json only inventories the first,
      // so every cli/ path recorded in .bk-version.json used to look like a file the
      // package had dropped — update reported 18 "removed from package" warnings and
      // never upgraded a single CLI file. Inventory both, and resolve each path against
      // the tree it actually came from.
      const kitFiles = buildPackageInventory(kitManifest.files, packageRoot);

      console.log(`Updating ${platform} kit in ${claudeDir}...\n`);

      // Classify all files
      const allPaths = new Set([...Object.keys(kitFiles), ...Object.keys(installedFiles)]);
      let updated = 0;
      let added = 0;
      let skipped = 0;
      let conflicts = 0;
      let skipAll = false;

      for (const relPath of allPaths) {
        const kitHash = kitFiles[relPath];
        const installHash = installedFiles[relPath];
        const targetPath = join(claudeDir, relPath);
        const currentHash = existsSync(targetPath) ? hashFile(targetPath) : undefined;

        const state = classifyChange(kitHash, installHash, currentHash);

        switch (state) {
          case 'unchanged':
            // Nothing to do
            break;

          case 'new': {
            const srcPath = sourceFor(relPath, { kitDir, packageRoot });
            if (existsSync(srcPath)) {
              mkdirSync(join(targetPath, '..'), { recursive: true });
              cpSync(srcPath, targetPath);
              installedFiles[relPath] = kitHash;
              added++;
              console.log(`  + ${relPath} (new)`);
            }
            break;
          }

          case 'safe_update': {
            const srcPath = sourceFor(relPath, { kitDir, packageRoot });
            if (existsSync(srcPath)) {
              mkdirSync(join(targetPath, '..'), { recursive: true });
              cpSync(srcPath, targetPath);
              installedFiles[relPath] = kitHash;
              updated++;
              console.log(`  ↑ ${relPath} (updated)`);
            }
            break;
          }

          case 'conflict': {
            if (skipAll) {
              skipped++;
              console.log(`  ⊘ ${relPath} (skipped)`);
              break;
            }

            const choice = await promptConflict(relPath, opts.conflict);
            if (choice === 'skip_all') {
              skipAll = true;
              skipped++;
              break;
            }
            if (choice === 'take') {
              const srcPath = sourceFor(relPath, { kitDir, packageRoot });
              if (existsSync(srcPath)) {
                cpSync(srcPath, targetPath);
                installedFiles[relPath] = kitHash;
                updated++;
                console.log(`  ↑ ${relPath} (took package version)`);
              }
            } else {
              skipped++;
              console.log(`  ⊘ ${relPath} (kept yours)`);
            }
            conflicts++;
            break;
          }

          case 'user_deleted':
            console.log(`  ⚠ ${relPath} (you deleted this file, skipping)`);
            break;

          case 'deleted':
            console.log(`  ⚠ ${relPath} (removed from package, keeping local copy)`);
            delete installedFiles[relPath];
            break;
        }
      }

      // Update .bk-version.json
      versionData.version = kitManifest.version;
      versionData.files = installedFiles;
      writeFileSync(versionPath, JSON.stringify(versionData, null, 2) + '\n', 'utf8');

      // Summary
      console.log(`\n  ${updated} updated, ${added} new, ${skipped} skipped, ${conflicts} conflict(s)`);

      if (updated + added > 0) {
        console.log('  ✓ .bk-version.json updated');
      } else {
        console.log('  ✓ Already up to date');
      }
    });
}
