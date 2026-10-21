/**
 * init-model-preset.mjs — `bk init --models <preset>`: choose and persist an agent-model preset.
 *
 * init resolves the preset after the kit is copied, writes the non-default `models` map to
 * `.claude/.bk.json`, and the existing readModelOverrides/applyModeToInstalledAgents step then
 * applies it — the same path `bk update` uses, so recorded hashes stay consistent. `balanced`
 * (the kit defaults) writes nothing, so a plain init is unchanged.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { hashFile } from './hash-tracker.mjs';
import { PRESET_NAMES, buildPreset, describePreset, readAgentDefaults } from './model-presets.mjs';
import { writeModels } from './bk-config-writer.mjs';
import { askChoice } from './prompt-choice.mjs';

export const DEFAULT_PRESET = 'balanced';

/**
 * Validate the `--models` value. Call before anything touches disk.
 * @param {string|undefined} value
 * @returns {string|undefined} the preset, or undefined when the flag was not given
 * @throws {Error} on an unknown preset
 */
export function parseModelsOption(value) {
  if (value === undefined) return undefined;
  if (!PRESET_NAMES.includes(value)) {
    throw new Error(`Unknown --models preset "${value}" (expected ${PRESET_NAMES.join(' | ')}).`);
  }
  return value;
}

/**
 * Explicit flag, else a prompt on an interactive terminal (unless --yes), else balanced.
 * @returns {Promise<string>}
 */
export async function resolveModelPreset({ explicit, yes = false, isTTY = Boolean(process.stdin.isTTY), input, output }) {
  if (explicit) return explicit;
  if (yes || !isTTY) return DEFAULT_PRESET;
  return askChoice({
    question: '\nWhich model preset for the kit agents?',
    choices: PRESET_NAMES.map((value) => ({ value, description: describePreset(value) })),
    defaultValue: DEFAULT_PRESET,
    input,
    output,
  });
}

/**
 * Write the preset's overrides to .bk.json (installed agents are read for their defaults).
 * @returns {number} agents the preset overrides (0 for balanced: nothing written)
 */
export function persistModelPreset({ targetDir, claudeDir, preset }) {
  if (preset === DEFAULT_PRESET) return 0;
  const models = buildPreset(preset, readAgentDefaults(join(claudeDir, 'agents')));
  if (Object.keys(models).length === 0) return 0;
  writeModels(targetDir, models);
  return Object.keys(models).length;
}

/**
 * Record `.bk.json` at the KIT's hash, not the hash of the file with the preset in it.
 * `.bk.json` is the user's file: if the recorded hash were the edited file's, the next
 * `bk update` would see "unmodified since install, package differs" and overwrite the models
 * with the kit's `.bk.json`. Recorded == package keeps it 'unchanged', exactly as for a plain
 * init and as after `bk models`.
 * @param {Record<string,string>} fileHashes — hashAllFiles(claudeDir), mutated
 */
export function recordPristineConfigHash(fileHashes, kitDir) {
  const kitConfig = join(kitDir, '.bk.json');
  if ('.bk.json' in fileHashes && existsSync(kitConfig)) fileHashes['.bk.json'] = hashFile(kitConfig);
  return fileHashes;
}
