/**
 * apply-model-overrides.mjs — Push a changed `.bk.json` `models` map into the installed agents.
 *
 * `bk models` edits `.bk.json` and must not leave the project waiting for the next `bk update`.
 * This re-installs every kit agent whose override changed through the SAME path update uses
 * (installFileForMode: package content under the current context mode + the new overrides) and
 * records the hash of what was written in .bk-version.json. Because that is exactly the content
 * `inventoryForMode` hashes, a following `bk update` sees recorded == package and reports
 * nothing, and `bk doctor` finds no drift.
 *
 * An agent whose file no longer matches its recorded hash carries the user's own edits; it is
 * left untouched and reported, never overwritten. With no recorded hash the file counts as edited
 * unless it equals the package content for the current mode + previous overrides.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashFile } from './hash-tracker.mjs';
import { contentForMode, installFileForMode, isKitAgentPath } from './subagent-context-mode.mjs';

/** Names of the kit agents the package ships (`_`-prefixed templates excluded). */
export function packageAgentNames(kitDir) {
  const dir = join(kitDir, 'agents');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => isKitAgentPath(`agents/${f}`)).map((f) => f.slice(0, -3)).sort();
}

/**
 * @param {{ targetDir: string, claudeDir: string, kitDir: string,
 *           before: object, after: object, mode: 'lean'|'full' }} args
 *   before/after — validated override maps (agent -> {model?, effort?})
 * @returns {{ changed: string[], skipped: string[] }} agent names rewritten / left alone (edited locally)
 */
export function applyModelOverrides({ targetDir, claudeDir, kitDir, before, after, mode }) {
  const versionPath = join(targetDir, '.bk-version.json');
  const record = existsSync(versionPath) ? JSON.parse(readFileSync(versionPath, 'utf8')) : null;
  const files = record?.files ?? {};
  const changed = [];
  const skipped = [];

  for (const name of packageAgentNames(kitDir)) {
    if (JSON.stringify(before[name] ?? null) === JSON.stringify(after[name] ?? null)) continue;
    const rel = `agents/${name}.md`;
    const target = join(claudeDir, rel);
    if (!existsSync(target)) continue; // not installed in this project
    // Recorded hash: edited iff it differs. No recorded hash: assume edited unless the file is
    // exactly what the package installs for this mode + the previous overrides.
    const edited = files[rel]
      ? hashFile(target) !== files[rel]
      : readFileSync(target, 'utf8') !== contentForMode(rel, readFileSync(join(kitDir, rel), 'utf8'), mode, before);
    if (edited) {
      skipped.push(name);
      continue;
    }
    installFileForMode(rel, join(kitDir, rel), target, mode, after);
    files[rel] = hashFile(target);
    changed.push(name);
  }

  if (record && changed.length > 0) {
    record.files = files;
    writeFileSync(versionPath, JSON.stringify(record, null, 2) + '\n', 'utf8');
  }
  return { changed, skipped };
}
