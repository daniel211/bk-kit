/**
 * model-override-doctor.mjs — Pure helpers for doctor's "Agent models" check.
 *
 * Defaults come from the PACKAGE kit's agent files (readAgentDefaults on the kit's agents/),
 * not the installed ones: the installed frontmatter already carries the overrides, so it
 * cannot tell a default from an override. With no package defaults (no kit dir) both helpers
 * degrade quietly: no preset is named, and effort/model is judged on the override alone.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildPreset } from './model-presets.mjs';
import { hashFile } from './hash-tracker.mjs';

/** Presets worth naming; `balanced` is the empty map and never reaches a non-empty override set. */
const NAMED_PRESETS = ['quality', 'economy'];

const HIGH_EFFORT = ['high', 'xhigh', 'max'];

const sameModels = (a, b) => {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length &&
    ka.every((k) => b[k] && a[k].model === b[k].model && a[k].effort === undefined && b[k].effort === undefined);
};

/**
 * Name of the preset the active overrides exactly equal, or null.
 * @param {Record<string,{model?:string,effort?:string}>} overrides
 * @param {Record<string,{model?:string|null}>} defaults — readAgentDefaults of the package kit
 * @returns {string|null}
 */
export function matchedPreset(overrides, defaults) {
  if (!defaults || Object.keys(defaults).length === 0) return null;
  return NAMED_PRESETS.find((name) => sameModels(overrides, buildPreset(name, defaults))) || null;
}

/**
 * Warnings for overrides pairing haiku with high/xhigh/max effort (haiku is not meant for it).
 * The model is the override's, else the agent's package default.
 * @returns {string[]}
 */
export function haikuEffortWarnings(overrides, defaults = {}) {
  const out = [];
  for (const [agent, o] of Object.entries(overrides || {})) {
    const model = o.model ?? defaults[agent]?.model;
    if (model === 'haiku' && HIGH_EFFORT.includes(o.effort)) {
      out.push(`${agent}: effort "${o.effort}" on haiku (models.${agent}) — haiku is not meant for high effort; use sonnet or lower the effort`);
    }
  }
  return out;
}

/**
 * Mismatched agents (`agents/x.md`) whose file differs from the recorded hash, or has none:
 * `bk update` keeps those unless run with `--conflict take`.
 * @param {string} claudeDir
 * @param {string[]} mismatched
 * @param {Record<string,string>} recordedFiles — .bk-version.json `files`
 * @returns {string[]}
 */
export function locallyEditedAgents(claudeDir, mismatched, recordedFiles = {}) {
  return mismatched.filter((rel) => {
    const file = join(claudeDir, rel);
    return existsSync(file) && (!recordedFiles[rel] || hashFile(file) !== recordedFiles[rel]);
  });
}
