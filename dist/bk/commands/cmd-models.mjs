/**
 * cmd-models.mjs — `bk models`: view and change which model/effort each kit agent runs on.
 *
 *   bk models list
 *   bk models set <agent> <model> [--effort <e>]
 *   bk models preset <quality|balanced|economy> [--yes]
 *   bk models reset [agent]
 *
 * The choice lives in `.bk.json` `models` (written through bk-config-writer, never clobbering
 * other keys) and is applied at once to the installed agent files (apply-model-overrides.mjs),
 * hashes included, so a later `bk update` / `bk doctor` finds nothing to report.
 * Handlers take a context and throw ModelsError; the commander actions turn that into exit 1.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { addKitOption, resolveKitOrExit } from '../lib/kit-resolver.mjs';
import { kitLayout, packageRootFrom } from '../lib/package-layout.mjs';
import { readAgentDefaults, buildPreset, describePreset, PRESET_NAMES } from '../lib/model-presets.mjs';
import { readModelOverrides, validateModelOverrides, loadKnownModelIds } from '../lib/agent-model-override.mjs';
import { readSubagentContextMode } from '../lib/subagent-context-mode.mjs';
import { updateBkConfig, writeModels, setModelsKey } from '../lib/bk-config-writer.mjs';
import { applyModelOverrides } from '../lib/apply-model-overrides.mjs';

export class ModelsError extends Error {}

/** Resolve paths for one invocation; throws if the project has no .claude/. */
export function buildContext({ target = '.', kit, packageRoot }) {
  const targetDir = resolve(target);
  const claudeDir = join(targetDir, '.claude');
  if (!existsSync(claudeDir)) throw new ModelsError(`${claudeDir} not found. Run "bk init" first.`);
  const { kitDir } = kitLayout(packageRoot, kit);
  return { targetDir, claudeDir, kitDir };
}

const fmt = (e) => (e?.model ? `${e.model}${e.effort ? ` (${e.effort})` : ''}` : '-');
const merged = (def, o) => ({ model: o?.model ?? def?.model, effort: o?.effort ?? def?.effort });

/** Edit distance, for "did you mean" on a mistyped agent name. */
function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}

function assertAgent(name, defaults) {
  if (Object.hasOwn(defaults, name)) return;
  const near = Object.keys(defaults).sort((x, y) => distance(name, x) - distance(name, y))[0];
  throw new ModelsError(`Unknown agent "${name}".${near ? ` Did you mean "${near}"?` : ''}`);
}

/** Persist `after` in .bk.json, then rewrite the affected agent files. */
function commit(ctx, before, after, writeConfig) {
  writeConfig();
  const result = applyModelOverrides({ ...ctx, before, after, mode: readSubagentContextMode(ctx.targetDir) });
  for (const n of result.changed) console.log(`  ✓ agents/${n}.md updated`);
  for (const n of result.skipped) {
    console.log(`  ⚠ agents/${n}.md has local edits; not rewritten (bk update --conflict take applies the setting)`);
  }
  return result;
}

export function listModels(ctx) {
  const pkg = readAgentDefaults(join(ctx.kitDir, 'agents'));
  const installed = readAgentDefaults(join(ctx.claudeDir, 'agents'));
  const { overrides } = readModelOverrides(ctx.targetDir, [ctx.kitDir]);
  console.log(`${'agent'.padEnd(28)}${'default'.padEnd(18)}${'effective'.padEnd(18)}override`);
  for (const name of Object.keys(installed)) {
    const mark = overrides[name] ? '*' : '';
    console.log(`${name.padEnd(28)}${fmt(pkg[name]).padEnd(18)}${fmt(installed[name]).padEnd(18)}${mark}`);
  }
}

export function setModel(ctx, agent, model, effort) {
  const defaults = readAgentDefaults(join(ctx.kitDir, 'agents'));
  assertAgent(agent, defaults);
  const entry = {};
  if (model) entry.model = model;
  if (effort) entry.effort = effort;
  const { overrides: valid, warnings } = validateModelOverrides({ [agent]: entry }, loadKnownModelIds([ctx.claudeDir, ctx.kitDir]));
  if (warnings.length > 0 || !valid[agent]) throw new ModelsError(warnings.join('\n') || 'Nothing to set.');
  const { overrides: before } = readModelOverrides(ctx.targetDir, [ctx.kitDir]);
  const after = { ...before, [agent]: { ...before[agent], ...valid[agent] } };
  commit(ctx, before, after, () => updateBkConfig(ctx.targetDir, (obj) => {
    const models = obj.models && typeof obj.models === 'object' && !Array.isArray(obj.models) ? obj.models : {};
    return setModelsKey(obj, { ...models, [agent]: after[agent] });
  }));
  console.log(`${agent}: ${fmt(merged(defaults[agent], after[agent]))}`);
}

/** The `models` map exactly as written in .bk.json (before validation), or {}. */
function rawModels(ctx) {
  try {
    const m = JSON.parse(readFileSync(join(ctx.claudeDir, '.bk.json'), 'utf8')).models;
    return m && typeof m === 'object' && !Array.isArray(m) ? m : {};
  } catch { return {}; }
}

async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((done) => {
    rl.once('close', () => done(false));
    rl.question(question, (a) => { rl.close(); done(/^y(es)?$/i.test(a.trim())); });
  });
}

export async function applyPreset(ctx, name, { yes = false, ask = confirm } = {}) {
  if (!PRESET_NAMES.includes(name)) throw new ModelsError(`Unknown preset "${name}" (expected ${PRESET_NAMES.join('|')}).`);
  const defaults = readAgentDefaults(join(ctx.kitDir, 'agents'));
  const { overrides: before } = readModelOverrides(ctx.targetDir, [ctx.kitDir]);
  const after = buildPreset(name, defaults);
  console.log(`Preset ${name}: ${describePreset(name)}`);
  const known = (n) => Object.hasOwn(defaults, n);
  const names = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().filter(known);
  const diff = names.filter((n) => fmt(merged(defaults[n], before[n])) !== fmt(merged(defaults[n], after[n])));
  for (const n of diff) console.log(`  ${n}: ${fmt(merged(defaults[n], before[n]))} -> ${fmt(merged(defaults[n], after[n]))}`);
  // Preset replaces the whole map: list every raw entry the result does not carry as-is
  // (unknown agent, invalid, effort-only, or an effort/extra field the preset would lose).
  const raw = rawModels(ctx);
  const dropped = Object.keys(raw).sort().filter((n) => JSON.stringify(raw[n]) !== JSON.stringify(after[n]) &&
    (!known(n) || !before[n] || !after[n] || !before[n].model || before[n].effort || JSON.stringify(raw[n]) !== JSON.stringify(before[n])));
  for (const n of dropped) {
    const why = !known(n) ? 'unknown agent' : !before[n] ? 'invalid entry' : !before[n].model ? 'effort-only override' : 'replaced by the preset';
    console.log(`  ${n}: ${JSON.stringify(raw[n])} dropped (${why})`);
  }
  if (diff.length === 0 && dropped.length === 0) console.log('  (no agent changes)');
  if (!yes) {
    if (!process.stdin.isTTY && ask === confirm) throw new ModelsError('Not a terminal: re-run with --yes to apply the preset.');
    if (!(await ask('Apply? [y/N] '))) { console.log('Cancelled.'); return; }
  }
  commit(ctx, before, after, () => writeModels(ctx.targetDir, after));
}

export function resetModels(ctx, agent) {
  const defaults = readAgentDefaults(join(ctx.kitDir, 'agents'));
  if (agent) assertAgent(agent, defaults);
  const { overrides: before } = readModelOverrides(ctx.targetDir, [ctx.kitDir]);
  const after = { ...before };
  if (agent) delete after[agent]; else for (const k of Object.keys(after)) delete after[k];
  commit(ctx, before, after, () => updateBkConfig(ctx.targetDir, (obj) => {
    if (!agent) return setModelsKey(obj, null);
    const rest = { ...(obj.models || {}) };
    delete rest[agent];
    return setModelsKey(obj, rest);
  }));
  console.log(agent ? `${agent}: back to kit default` : 'All model overrides removed.');
}

/** Wrap a handler: build the context, turn ModelsError into a message + exit 1. */
function run(fn) {
  return async (...args) => {
    const o = args[args.length - 2];
    try {
      const packageRoot = packageRootFrom(import.meta.dirname);
      const kit = resolveKitOrExit({ packageRoot, targetDir: resolve(o.target), explicit: o.kit });
      await fn(buildContext({ target: o.target, kit, packageRoot }), ...args.slice(0, -2), o);
    } catch (err) {
      if (!(err instanceof ModelsError) && !/\.bk\.json/.test(err.message)) throw err;
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  };
}

/** @param {import('commander').Command} program */
export function registerModels(program) {
  const models = program.command('models').description('View and change the model each kit agent runs on');
  const sub = (cmd) => addKitOption(cmd.option('--target <dir>', 'Target project directory', '.'));
  sub(models.command('list').description('Show kit defaults, effective models and overrides'))
    .action(run((ctx) => listModels(ctx)));
  sub(models.command('set <agent> <model>').description('Override one agent').option('--effort <level>', 'low|medium|high|xhigh|max'))
    .action(run((ctx, agent, model, o) => setModel(ctx, agent, model, o.effort)));
  sub(models.command('preset <name>').description(`Apply a preset (${PRESET_NAMES.join('|')})`).option('--yes', 'Skip confirmation'))
    .action(run((ctx, name, o) => applyPreset(ctx, name, { yes: o.yes })));
  sub(models.command('reset [agent]').description('Remove one or all overrides'))
    .action(run((ctx, agent) => resetModels(ctx, agent)));
}
