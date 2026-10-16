/**
 * cmd-update.mjs — Sync installed .claude/ kit with latest package version.
 *
 * Compares installed file hashes against package kit hashes.
 * Auto-updates safe files, prompts for conflicts.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { hashFile } from '../lib/hash-tracker.mjs';
import { buildPackageInventory, kitLayout, packageRootFrom, sourceFor } from '../lib/package-layout.mjs';
import { addKitOption, resolveKitOrExit } from '../lib/kit-resolver.mjs';
import {
  installFileForMode, inventoryForMode, readSubagentContextMode, reconcileModeOnly,
} from '../lib/subagent-context-mode.mjs';
import { readModelOverrides, unknownOverrideAgents } from '../lib/agent-model-override.mjs';
import {
  gitPrefix, trackedSessionState, untrackCommand, writeGitignoreEntries,
} from '../lib/session-state-gitignore.mjs';

/**
 * Classify a file's change state by comparing 3 hashes.
 *
 * @param {string|undefined} kitHash — hash in current package's kit-manifest
 * @param {string|undefined} installHash — hash from .bk-version.json (what was installed)
 * @param {string|undefined} currentHash — hash of file currently on disk
 * @returns {"new"|"unchanged"|"safe_update"|"conflict"|"user_deleted"|"deleted"}
 */
export function classifyChange(kitHash, installHash, currentHash) {
  if (!installHash) return 'new';
  if (!kitHash) return 'deleted';
  if (!currentHash && installHash) return 'user_deleted';
  if (kitHash === installHash) return 'unchanged';
  if (currentHash === installHash) return 'safe_update';

  // The recorded hash can be stale while the file on disk is already exactly what the package
  // ships: `--conflict keep` deliberately leaves the old installHash behind (that is what keeps a
  // real local edit reported as a conflict next time), so a file kept once and later brought in
  // line with the package still carries a 0.9.0 hash. Updating fusionworkomni 0.9.0 → 0.9.1,
  // hooks/lib/bk-harness-policy.json was reported as a conflict while `cmp` showed it
  // byte-identical to the 0.9.1 package copy — and it would have been reported again on every
  // future update. Disk == package means there is nothing to update, whatever was recorded.
  if (currentHash && kitHash && currentHash === kitHash) return 'unchanged';

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
 * Bring every file in .claude/ to the package version, file by file, from three hashes
 * (classifyChange). Mutates `installedFiles` into the record to write back.
 *
 * `mode` is the `.bk.json` subagent context mode: in 'full' a kit agent installs without its
 * `omitClaudeMd: true` line, and its package hash is taken of THAT content, so recorded, disk
 * and package hashes stay comparable and a toggle never reads as a local edit (see
 * lib/subagent-context-mode.mjs). `models` is the validated `.bk.json` model override map; it is
 * applied to the kit agents it names in the same way (lib/agent-model-override.mjs).
 *
 * @param {{ claudeDir: string, kitDir: string, packageRoot: string,
 *           packageFiles: Record<string,string>, installedFiles: Record<string,string>,
 *           mode?: 'lean'|'full', models?: object, conflict?: 'prompt'|'keep'|'take' }} opts
 * @returns {Promise<{ updated: number, added: number, skipped: number, conflicts: number }>}
 */
export async function syncKitFiles({
  claudeDir, kitDir, packageRoot, packageFiles, installedFiles, mode = 'lean', models, conflict = 'prompt',
}) {
  const sourceOf = (relPath) => sourceFor(relPath, { kitDir, packageRoot });
  const kitFiles = inventoryForMode(packageFiles, sourceOf, mode, models);
  const install = (relPath, targetPath) => installFileForMode(relPath, sourceOf(relPath), targetPath, mode, models);

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
        // No file to copy, but the record may be the stale one that made this look like a
        // conflict (see classifyChange). Refreshing it here is what stops the phantom
        // conflict from coming back on every subsequent update; it is a no-op whenever the
        // recorded hash already agrees with the package.
        installedFiles[relPath] = kitHash;
        break;

      case 'new': {
        if (existsSync(sourceOf(relPath))) {
          install(relPath, targetPath);
          installedFiles[relPath] = kitHash;
          added++;
          console.log(`  + ${relPath} (new)`);
        }
        break;
      }

      case 'safe_update': {
        if (existsSync(sourceOf(relPath))) {
          install(relPath, targetPath);
          installedFiles[relPath] = kitHash;
          updated++;
          console.log(`  ↑ ${relPath} (updated)`);
        }
        break;
      }

      case 'conflict': {
        // A kit agent the user edited, whose only package-side change is the subagent context
        // mode: toggle the flag line in their copy instead of asking them to choose between
        // their edits and the mode.
        const modeHash = reconcileModeOnly({
          relPath, srcPath: sourceOf(relPath), targetPath, installHash, mode, models,
        });
        if (modeHash) {
          installedFiles[relPath] = modeHash;
          updated++;
          console.log(`  ↻ ${relPath} (kept your edits; omitClaudeMd ${mode === 'full' ? 'removed' : 'restored'} for subagent context "${mode}")`);
          break;
        }
        if (skipAll) {
          skipped++;
          console.log(`  ⊘ ${relPath} (skipped)`);
          break;
        }

        const choice = await promptConflict(relPath, conflict);
        if (choice === 'skip_all') {
          skipAll = true;
          skipped++;
          break;
        }
        if (choice === 'take') {
          if (existsSync(sourceOf(relPath))) {
            install(relPath, targetPath);
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

  return { updated, added, skipped, conflicts };
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
    .option('--conflict <strategy>', 'How to resolve conflicts without asking: keep | take', 'prompt')
    .option('--no-gitignore', "Do not add the kit's per-machine state files to .gitignore");

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
      const packageFiles = buildPackageInventory(kitManifest.files, packageRoot);

      // `.bk.json` subagents.fullContext changes what a kit agent installs as (see
      // lib/subagent-context-mode.mjs); a toggled setting takes effect here.
      const mode = readSubagentContextMode(targetDir);
      const { overrides: models, warnings: modelWarnings } = readModelOverrides(targetDir, [kitDir]);

      console.log(`Updating ${platform} kit in ${claudeDir}...\n`);
      if (mode === 'full') console.log('  Subagent context: full (.bk.json subagents.fullContext) — kit agents install without omitClaudeMd\n');
      for (const w of modelWarnings) console.log(`  ⚠ ${w}`);
      if (Object.keys(models).length > 0) {
        console.log(`  Agent models: ${Object.keys(models).join(', ')} (.bk.json models)\n`);
        const unknown = unknownOverrideAgents(models, claudeDir);
        if (unknown.length > 0) console.log(`  ⚠ .bk.json models names no installed kit agent: ${unknown.join(', ')}\n`);
      }

      const { updated, added, skipped, conflicts } = await syncKitFiles({
        claudeDir, kitDir, packageRoot, packageFiles, installedFiles, mode, models, conflict: opts.conflict,
      });

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

      if (opts.gitignore !== false) reconcileSessionStateIgnore(targetDir);
    });
}

/**
 * Bring an existing project's .gitignore up to the never-commit list, and say so when state
 * is already tracked.
 *
 * `update` otherwise never touches a file the user owns, so this is deliberate: appending
 * missing ignore lines is additive and idempotent — no user rule is changed or removed, and a
 * broader rule the user already has counts as covering (see missingIgnoreEntries). Without it
 * the fix would reach new installs only; every project initialised before init wrote the
 * entries by default — X-Game-Pro, the case that motivated it, included — would stay exposed.
 * `--no-gitignore` opts out, as it does for init.
 *
 * Untracking is only reported, never done: `git rm --cached` stages deletions into the user's
 * next commit, which is theirs to make.
 *
 * @param {string} targetDir
 */
export function reconcileSessionStateIgnore(targetDir) {
  if (gitPrefix(targetDir) === null) return;

  const added = writeGitignoreEntries(targetDir);
  if (added.length > 0) {
    console.log(`  ✓ Added ${added.length} session-state entr${added.length === 1 ? 'y' : 'ies'} to .gitignore (--no-gitignore to skip)`);
  }

  const tracked = trackedSessionState(targetDir);
  if (tracked && tracked.files.length > 0) {
    console.log(`  ⚠ ${tracked.files.length} session-state file(s) are tracked by git; .gitignore does not untrack them:`);
    console.log(`      ${untrackCommand(tracked.pathspecs)}`);
    console.log('    then commit. "bk doctor" lists the files.');
  }
}
