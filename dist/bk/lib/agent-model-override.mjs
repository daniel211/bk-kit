/**
 * agent-model-override.mjs — Apply `.bk.json` `models` to the installed kit agents.
 *
 *   { "models": { "bk-planner": { "model": "sonnet", "effort": "high" } } }
 *
 * Why the CLI rewrites agent frontmatter, and not a hook or the dispatching skill:
 *  - A hook can add context to a subagent but nothing in this kit rewrites a Task call
 *    (no hook emits `updatedInput`), so a hook cannot change the model of a dispatch.
 *  - Skills used to force `model: "opus"` in their dispatch examples, which beat the agent file.
 *    Those are gone; with no `model` argument Claude Code runs the agent on the `model:` /
 *    `effort:` of its own frontmatter. So the one place that decides is the installed agent
 *    file, and this module is what writes the project's choice into it.
 *  - Same shape as `subagents.fullContext` (subagent-context-mode.mjs): applied by init/update,
 *    and `update` hashes the agent AS INSTALLED, so recorded, disk and package hashes stay
 *    comparable — an override is never read as a local edit and never a phantom conflict.
 *
 * `.bk.json` is the user's file (the kit never overwrites it; the agent files it changes are
 * kit-owned and rewritten by every `bk update`, which is why the choice lives here and not in
 * them). Read from the project only, as for fullContext: the agent files are committed.
 *
 * Invalid values are ignored with a one-line warning each; nothing invalid ever reaches a file.
 * No override → every function here returns its input unchanged (defaults stay identical).
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfigFromPath } from './kit-drift.mjs';

/** Aliases Claude Code accepts in agent frontmatter. */
export const MODEL_ALIASES = ['opus', 'sonnet', 'haiku'];
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];

/**
 * Full model ids the kit prices (model-pricing.json `models`, minus the `unknown` fallback).
 * Read from the installed kit, else the package kit; empty when neither is there — then any
 * `claude-…` id shape is accepted rather than rejecting a valid id for lack of a price table.
 * @param {string[]} dirs — candidate kit roots (e.g. [claudeDir, kitDir])
 * @returns {Set<string>}
 */
export function loadKnownModelIds(dirs) {
  for (const dir of dirs) {
    try {
      const file = join(dir, 'hooks', 'lib', 'model-pricing.json');
      if (!existsSync(file)) continue;
      const ids = Object.keys(JSON.parse(readFileSync(file, 'utf8')).models || {});
      return new Set(ids.filter((id) => id !== 'unknown'));
    } catch { /* next candidate */ }
  }
  return new Set();
}

function modelProblem(value, known) {
  if (typeof value !== 'string' || value === '') return 'must be a string';
  if (MODEL_ALIASES.includes(value)) return null;
  if (known.size > 0 ? known.has(value) : /^claude-[a-z0-9.-]+$/.test(value)) return null;
  return `expected ${MODEL_ALIASES.join('|')} or a model id from model-pricing.json`;
}

/**
 * Validate a raw `models` value.
 * @param {unknown} raw
 * @param {Set<string>} [known] — from loadKnownModelIds
 * @returns {{ overrides: Record<string,{model?:string,effort?:string}>, warnings: string[] }}
 */
export function validateModelOverrides(raw, known = new Set()) {
  const overrides = {};
  const warnings = [];
  if (raw === undefined || raw === null) return { overrides, warnings };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { overrides, warnings: ['.bk.json "models" ignored: expected an object of agent name -> { model, effort }'] };
  }
  for (const [agent, entry] of Object.entries(raw)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      warnings.push(`.bk.json models.${agent} ignored: expected { "model": ..., "effort": ... }`);
      continue;
    }
    const clean = {};
    if (entry.model !== undefined) {
      const problem = modelProblem(entry.model, known);
      if (problem) warnings.push(`.bk.json models.${agent}.model ignored: ${problem}`);
      else clean.model = entry.model;
    }
    if (entry.effort !== undefined) {
      if (EFFORT_LEVELS.includes(entry.effort)) clean.effort = entry.effort;
      else warnings.push(`.bk.json models.${agent}.effort ignored: expected ${EFFORT_LEVELS.join('|')}`);
    }
    if (clean.model || clean.effort) overrides[agent] = clean;
  }
  return { overrides, warnings };
}

/**
 * The project's valid model overrides, with one warning per ignored value.
 * @param {string} targetDir — project root containing .claude/
 * @param {string[]} [kitRoots] — where to look for model-pricing.json
 */
export function readModelOverrides(targetDir, kitRoots = []) {
  const cfg = loadConfigFromPath(join(targetDir, '.claude', '.bk.json'));
  return validateModelOverrides(cfg?.models, loadKnownModelIds([join(targetDir, '.claude'), ...kitRoots]));
}

/** `agents/bk-planner.md` -> `bk-planner`; null for anything that is not a shipped kit agent. */
export function kitAgentName(relPath) {
  const m = /^agents[\\/]([^_\\/][^\\/]*)\.md$/.exec(relPath);
  return m ? m[1] : null;
}

function frontmatterEnd(content) {
  return content.startsWith('---') ? content.indexOf('\n---', 3) : -1;
}

function setKey(head, key, value) {
  const line = new RegExp(`\\n${key}:[^\\n]*`);
  if (line.test(head)) return head.replace(line, `\n${key}: ${value}`);
  // Missing key: after `model:` for effort, else last — where the kit agents carry them.
  const anchor = key === 'effort' ? /\nmodel:[^\n]*/.exec(head) : null;
  const at = anchor ? anchor.index + anchor[0].length : head.length;
  return head.slice(0, at) + `\n${key}: ${value}` + head.slice(at);
}

/** The agent content with `model:` / `effort:` set from `override`; unchanged when it has none. */
export function applyOverrideToContent(content, override) {
  if (!override || (!override.model && !override.effort)) return content;
  const end = frontmatterEnd(content);
  if (end < 0) return content;
  let head = content.slice(0, end);
  if (override.model) head = setKey(head, 'model', override.model);
  if (override.effort) head = setKey(head, 'effort', override.effort);
  return head + content.slice(end);
}

/**
 * What a package file becomes under `overrides` (only kit agents with an entry change).
 * @param {string} relPath
 * @param {string} content
 * @param {Record<string,{model?:string,effort?:string}>} [overrides]
 */
export function contentWithOverride(relPath, content, overrides) {
  const name = kitAgentName(relPath);
  if (!name || !overrides || !overrides[name]) return content;
  return applyOverrideToContent(content, overrides[name]);
}

/** True when no override applies to any agent (the common case — callers can skip the work). */
export const hasOverrides = (overrides) => !!overrides && Object.keys(overrides).length > 0;

/** Overrides naming an agent that is not installed — a typo or another platform's agent. */
export function unknownOverrideAgents(overrides, claudeDir) {
  const agentsDir = join(claudeDir, 'agents');
  const installed = new Set(
    existsSync(agentsDir) ? readdirSync(agentsDir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)) : [],
  );
  return Object.keys(overrides || {}).filter((name) => !installed.has(name)).sort();
}

function frontmatterValue(content, key) {
  const end = frontmatterEnd(content);
  if (end < 0) return null;
  const m = new RegExp(`\\n${key}:[ \\t]*([^\\n#]*)`).exec(content.slice(0, end));
  return m ? m[1].trim() : null;
}

/**
 * Installed kit agents whose frontmatter does not carry their override (doctor).
 * @returns {{ total: number, mismatched: string[] }} total = overrides that name an installed agent
 */
export function agentsOutOfOverride(claudeDir, overrides) {
  const mismatched = [];
  let total = 0;
  for (const [name, o] of Object.entries(overrides || {})) {
    const file = join(claudeDir, 'agents', `${name}.md`);
    if (!existsSync(file)) continue;
    total++;
    const content = readFileSync(file, 'utf8');
    if ((o.model && frontmatterValue(content, 'model') !== o.model) ||
        (o.effort && frontmatterValue(content, 'effort') !== o.effort)) {
      mismatched.push(`agents/${name}.md`);
    }
  }
  return { total, mismatched: mismatched.sort() };
}
