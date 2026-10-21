/**
 * model-presets.mjs — Named `models` presets for `.bk.json` (used by `bk models`).
 *
 *   quality  — every kit agent on opus
 *   balanced — empty map: the kit's own per-agent defaults
 *   economy  — one step down per agent: opus -> sonnet, sonnet -> haiku, haiku stays;
 *              except NO_DOWNGRADE agents, which keep their default
 *
 * No agent names are hardcoded besides NO_DOWNGRADE: the agent list and each agent's default
 * `model:` / `effort:` are read from the frontmatter of the agent .md files (`readAgentDefaults`),
 * so a new kit agent is covered automatically. Presets never set `effort`, and omit an agent
 * whose resulting model equals its default (the map holds only real overrides). Output is valid
 * for `validateModelOverrides` (agent-model-override.mjs owns validation; not duplicated here).
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Agents whose quality matters too much to downgrade in `economy`. */
export const NO_DOWNGRADE = ['bk-planner', 'bk-security-auditor', 'bk-debugger'];

export const PRESET_NAMES = ['quality', 'balanced', 'economy'];

const DESCRIPTIONS = {
  quality: 'every agent on opus (highest quality, highest cost)',
  balanced: 'kit defaults (no overrides)',
  economy: 'one tier cheaper per agent (opus->sonnet, sonnet->haiku); planner, security-auditor and debugger keep their default',
};

const DOWNGRADE = { opus: 'sonnet', sonnet: 'haiku' };

/** One-line description of a preset. */
export function describePreset(name) {
  if (!PRESET_NAMES.includes(name)) throw new Error(`Unknown preset "${name}" (expected ${PRESET_NAMES.join('|')})`);
  return DESCRIPTIONS[name];
}

/** Value of a top-level frontmatter key, or null. */
function frontmatterValue(content, key) {
  if (!content.startsWith('---')) return null;
  const end = content.indexOf('\n---', 3);
  if (end < 0) return null;
  const m = new RegExp(`\\n${key}:[ \\t]*([^\\n#]*)`).exec(content.slice(0, end));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') || null : null;
}

/**
 * Agents in a directory with their default model/effort (`_`-prefixed files skipped).
 * @param {string} agentsDir
 * @returns {Record<string,{model:string|null,effort:string|null}>}
 */
export function readAgentDefaults(agentsDir) {
  const out = {}; // callers must test names with Object.hasOwn
  if (!existsSync(agentsDir)) return out;
  for (const file of readdirSync(agentsDir).sort()) {
    if (!file.endsWith('.md') || file.startsWith('_')) continue;
    const content = readFileSync(join(agentsDir, file), 'utf8');
    out[file.slice(0, -3)] = { model: frontmatterValue(content, 'model'), effort: frontmatterValue(content, 'effort') };
  }
  return out;
}

/**
 * Build a preset's `models` map.
 * @param {string} name — one of PRESET_NAMES
 * @param {Record<string,{model?:string|null}>} defaults — from readAgentDefaults
 * @returns {Record<string,{model:string}>}
 */
export function buildPreset(name, defaults) {
  if (!PRESET_NAMES.includes(name)) throw new Error(`Unknown preset "${name}" (expected ${PRESET_NAMES.join('|')})`);
  const models = {};
  if (name === 'balanced') return models;
  for (const [agent, def] of Object.entries(defaults || {})) {
    let target;
    if (name === 'quality') target = 'opus';
    else if (NO_DOWNGRADE.includes(agent)) continue;
    else target = DOWNGRADE[def?.model]; // haiku / unknown / unset: no change
    if (target && target !== def?.model) models[agent] = { model: target };
  }
  return models;
}
