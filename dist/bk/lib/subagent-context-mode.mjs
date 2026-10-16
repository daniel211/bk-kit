/**
 * subagent-context-mode.mjs — Apply `.bk.json` `subagents.fullContext` to the installed agents.
 *
 * Kit agents ship with `omitClaudeMd: true`: a kit subagent then loads none of CLAUDE.md, its
 * imports, the always-on rules or the auto-memory index, and subagent-init injects a role digest
 * plus the user's own CLAUDE.md files and memory index, capped ("lean", the default). Some
 * projects want the old behaviour back — a large project CLAUDE.md an agent must see in full,
 * or a pre-0.13 comparison — so `"subagents": { "fullContext": true }` restores it.
 *
 * Why the CLI and not a hook: what Claude Code loads into a subagent is decided by the agent's
 * frontmatter before any hook runs. SubagentStart can add context, never restore what the flag
 * dropped. So the setting is applied where the frontmatter is written — here, by `init` and
 * `update` — and subagent-init reads the result from the installed file.
 *
 * Why this cannot produce phantom conflicts. `update` decides per file from three hashes
 * (package, recorded, disk; cmd-update.mjs classifyChange). In full mode an agent's "package"
 * hash is the hash of the package file WITH the flag line stripped — the content this mode
 * installs — and init/update record that same hash. So:
 *  - mode unchanged, file untouched: package == recorded → unchanged (nothing to report);
 *  - mode toggled, file untouched: disk == recorded → safe_update, the file is rewritten;
 *  - doctor's drift check compares disk with the recorded hash, which already is the stripped one.
 * A file the user edited AND whose only package-side change is the toggle (recorded hash ==
 * the package under the other mode) is not a conflict either: only the flag line is changed in
 * the user's copy, and the new mode's package hash recorded, so a later real package change
 * still surfaces as a conflict against their edits (see reconcileModeOnly).
 *
 * `.bk.json` is read from the project only, as for doctorIgnore (kit-drift.mjs): the agent files
 * are committed, so the mode must not differ between two machines' global configs.
 */

import { createHash } from 'node:crypto';
import { cpSync, existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadConfigFromPath } from './kit-drift.mjs';
import { applyOverrideToContent, contentWithOverride, hasOverrides, kitAgentName } from './agent-model-override.mjs';

/** @typedef {'lean'|'full'} SubagentContextMode */

const FLAG_LINE = /\nomitClaudeMd:[ \t]*true\b[^\n]*/;
const ANY_FLAG = /\nomitClaudeMd:/;

/**
 * The mode `.claude/.bk.json` asks for.
 * @param {string} targetDir — project root containing .claude/
 * @returns {SubagentContextMode}
 */
export function readSubagentContextMode(targetDir) {
  const cfg = loadConfigFromPath(join(targetDir, '.claude', '.bk.json'));
  return cfg?.subagents?.fullContext === true ? 'full' : 'lean';
}

/**
 * A shipped kit agent: `agents/<name>.md`. `_`-prefixed files (_template.md,
 * _base-background-lite.md) are templates users copy, and stay as shipped.
 * @param {string} relPath — path relative to .claude/
 */
export function isKitAgentPath(relPath) {
  return /^agents[\\/][^_\\/][^\\/]*\.md$/.test(relPath);
}

function frontmatterEnd(content) {
  return content.startsWith('---') ? content.indexOf('\n---', 3) : -1;
}

/** The content without its `omitClaudeMd: true` frontmatter line (unchanged if it has none). */
export function stripOmitClaudeMd(content) {
  const end = frontmatterEnd(content);
  if (end < 0) return content;
  const head = content.slice(0, end);
  const next = head.replace(FLAG_LINE, '');
  return next === head ? content : next + content.slice(end);
}

/**
 * The content with `omitClaudeMd: true` back in its frontmatter — after `permissionMode:`, where
 * the kit agents carry it, else last. A file that sets omitClaudeMd to anything is left alone.
 */
export function restoreOmitClaudeMd(content) {
  const end = frontmatterEnd(content);
  if (end < 0) return content;
  const head = content.slice(0, end);
  if (ANY_FLAG.test(head)) return content;
  const perm = /\npermissionMode:[^\n]*/.exec(head);
  const at = perm ? perm.index + perm[0].length : end;
  return content.slice(0, at) + '\nomitClaudeMd: true' + content.slice(at);
}

/**
 * What the package file becomes when installed in `mode`, with the project's `models` overrides
 * (agent-model-override.mjs) applied to the kit agent they name. Both are rewrites of kit-agent
 * frontmatter, so they share this one place: every hash `update` takes goes through it.
 * @param {string} relPath
 * @param {string} content — the package file as shipped
 * @param {SubagentContextMode} mode
 * @param {Record<string,{model?:string,effort?:string}>} [models]
 */
export function contentForMode(relPath, content, mode, models) {
  const base = mode === 'full' && isKitAgentPath(relPath) ? stripOmitClaudeMd(content) : content;
  return contentWithOverride(relPath, base, models);
}

/** Does a kit agent at relPath install differently from the package file? */
function rewritesAgent(relPath, mode, models) {
  return isKitAgentPath(relPath) && (mode === 'full' || (hasOverrides(models) && !!models[kitAgentName(relPath)]));
}

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/**
 * The package inventory as it installs in `mode`: kit agent hashes are replaced by the hash of
 * what contentForMode writes. Everything else is returned as given.
 *
 * @param {Record<string,string>} inventory — path → package hash (buildPackageInventory)
 * @param {(relPath: string) => string} sourceOf — absolute package path for a relPath
 * @param {SubagentContextMode} mode
 * @param {Record<string,{model?:string,effort?:string}>} [models]
 * @returns {Record<string,string>}
 */
export function inventoryForMode(inventory, sourceOf, mode, models) {
  if (mode !== 'full' && !hasOverrides(models)) return inventory;
  const out = { ...inventory };
  for (const relPath of Object.keys(inventory)) {
    if (!rewritesAgent(relPath, mode, models)) continue;
    const src = sourceOf(relPath);
    if (!existsSync(src)) continue;
    const raw = readFileSync(src, 'utf8');
    const installed = contentForMode(relPath, raw, mode, models);
    if (installed !== raw) out[relPath] = sha256(installed);
  }
  return out;
}

/**
 * Copy one package file into .claude/ as it installs in `mode`.
 * @param {string} relPath
 * @param {string} srcPath
 * @param {string} targetPath
 * @param {SubagentContextMode} mode
 * @param {Record<string,{model?:string,effort?:string}>} [models]
 */
export function installFileForMode(relPath, srcPath, targetPath, mode, models) {
  mkdirSync(dirname(targetPath), { recursive: true });
  // Byte copy for everything the mode does not touch — the kit ships non-text files too.
  if (!rewritesAgent(relPath, mode, models)) cpSync(srcPath, targetPath);
  else writeFileSync(targetPath, contentForMode(relPath, readFileSync(srcPath, 'utf8'), mode, models));
}

/**
 * Bring every installed kit agent in `claudeDir` to `mode` in place (init, after the copy).
 * Only the lean → full direction (and model overrides) are needed there: init always copies the
 * package as shipped.
 * @returns {string[]} relPaths changed
 */
export function applyModeToInstalledAgents(claudeDir, mode, models) {
  const changed = [];
  const agentsDir = join(claudeDir, 'agents');
  if ((mode !== 'full' && !hasOverrides(models)) || !existsSync(agentsDir)) return changed;
  for (const name of readdirSync(agentsDir)) {
    const relPath = `agents/${name}`;
    if (!isKitAgentPath(relPath)) continue;
    const file = join(agentsDir, name);
    const raw = readFileSync(file, 'utf8');
    const next = contentForMode(relPath, raw, mode, models);
    if (next !== raw) {
      writeFileSync(file, next);
      changed.push(relPath);
    }
  }
  return changed;
}

/**
 * Update's mode-only case: the user edited a kit agent, and the package's only change to it is
 * the mode toggle (the recorded hash is the package under the OTHER mode). Toggle just the flag
 * line in their copy and return the hash to record (the package under the new mode); null when
 * this is not a mode-only change and the ordinary conflict handling applies.
 *
 * Recording the package hash (not the edited file's) is what keeps their customisation a
 * customisation: the next real package change still classifies as a conflict.
 *
 * @param {{ relPath: string, srcPath: string, targetPath: string, installHash: string|undefined,
 *           mode: SubagentContextMode, models?: Record<string,{model?:string,effort?:string}> }} args
 * @returns {string|null}
 */
export function reconcileModeOnly({ relPath, srcPath, targetPath, installHash, mode, models }) {
  if (!isKitAgentPath(relPath) || !installHash || !existsSync(srcPath) || !existsSync(targetPath)) return null;
  const raw = readFileSync(srcPath, 'utf8');
  const other = mode === 'full' ? 'lean' : 'full';
  if (sha256(contentForMode(relPath, raw, other, models)) !== installHash) return null;
  const mine = readFileSync(targetPath, 'utf8');
  const toggled = mode === 'full' ? stripOmitClaudeMd(mine) : restoreOmitClaudeMd(mine);
  const next = hasOverrides(models) && models[kitAgentName(relPath)]
    ? applyOverrideToContent(toggled, models[kitAgentName(relPath)])
    : toggled;
  if (next !== mine) writeFileSync(targetPath, next);
  return sha256(contentForMode(relPath, raw, mode, models));
}

/**
 * Kit agents whose installed frontmatter does not match `mode` (doctor).
 * @param {string} claudeDir
 * @param {Record<string,string>} files — the `files` map from .bk-version.json
 * @param {SubagentContextMode} mode
 * @returns {{ total: number, mismatched: string[] }}
 */
export function agentsOutOfMode(claudeDir, files, mode) {
  const mismatched = [];
  let total = 0;
  for (const relPath of Object.keys(files || {})) {
    if (!isKitAgentPath(relPath)) continue;
    let content;
    try {
      content = readFileSync(join(claudeDir, relPath), 'utf8');
    } catch {
      continue; // missing or unreadable: the drift check already reports it
    }
    const end = frontmatterEnd(content);
    if (end < 0) continue; // no frontmatter, not an agent Claude Code would load
    total++;
    const omits = /\nomitClaudeMd:[ \t]*true\b/.test(content.slice(0, end));
    if (omits !== (mode === 'lean')) mismatched.push(relPath);
  }
  return { total, mismatched: mismatched.sort() };
}
