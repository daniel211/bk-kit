/**
 * kit-switch.mjs — convert the installed platform-context.json when `bk update --kit <kit>`
 * switches a project from a single kit to a composite kit that contains it.
 *
 * `.claude/platform-context.json` is user-owned: `bk init` fills it from detection and the user
 * edits its commands and dirs. A switch from `ios` to `mobile_native` (or `python` to `fullstack`) must
 * not leave it in the single-kit shape — every composite-aware hook reads `components[]` — nor
 * replace it with the composite template, which would throw the user's edits away. So the
 * user's context becomes that component, unchanged apart from `id` / `root` / `present`, and the
 * composite's other components come from the kit template with the roots `bk init` would detect
 * (`present: false` when their markers do not exist yet — an iOS-only repo can take `mobile_native`
 * before its Android project exists). Contract: docs/kit-dev/plan-mobile-composite.md § 4.
 *
 * Composite → single (or → another composite) is refused: it would drop components the user may
 * have configured, and there is no lossless way to pick one. Nothing is written in that case.
 *
 * Exports:
 *   planKitSwitch(installedCtx, kitCtx)                   — 'none' | 'to-composite' | 'refuse'
 *   convertToComposite({ installedCtx, kitCtx, projectRoot }) — the converted context + lines
 *   switchInstalledContext({ claudeDir, kitDir, projectRoot }) — read, back up, rewrite
 */

import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyComponentDetection, detectComponents, displayRoot, hasComponents } from './component-detector.mjs';

/** Fields of a composite context that live at its top level, never inside a component. */
const TOP_LEVEL_ONLY = ['platform', 'components', 'mcpServers', 'templateVars', 'externalServices'];

/** File name the single-kit context is copied to before the rewrite. */
export function backupName(platform) {
  return `platform-context.${String(platform || 'previous').replace(/[^A-Za-z0-9_-]/g, '-')}.bak.json`;
}

/** True for a plain (non-array) object. */
function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

/** `./backend` / `backend/` / '' → `backend` / `backend` / null; `.` → null (no explicit root). */
function explicitRoot(root) {
  if (typeof root !== 'string') return null;
  const cleaned = root.trim().replace(/\\/g, '/').replace(/^(\.\/+)+/, '').replace(/\/+$/, '');
  return cleaned && cleaned !== '.' ? cleaned : null;
}

/**
 * What a switch from the installed context to the kit's template needs.
 *
 * @param {object|null} installedCtx - parsed installed platform-context.json (null: none / unreadable)
 * @param {object|null} kitCtx - parsed platform-context.json the target kit ships
 * @returns {{ kind: 'none'|'to-composite'|'refuse', message?: string }}
 */
export function planKitSwitch(installedCtx, kitCtx) {
  if (!isPlainObject(installedCtx) || !isPlainObject(kitCtx)) return { kind: 'none' };
  const from = installedCtx.platform;
  const to = kitCtx.platform;
  if (!from || !to || from === to) return { kind: 'none' };

  if (hasComponents(installedCtx)) {
    const ids = installedCtx.components.map((c) => (c && (c.id || c.platform)) || '?').join(', ');
    return {
      kind: 'refuse',
      message: `.claude/platform-context.json is the ${from} composite (components: ${ids}); switching it to`
        + ` the ${to} kit is not supported — it would drop components you may have configured.`
        + ` The file is unchanged. Keep --kit ${from}, or reinstall with \`bk init --force --kit ${to}\``
        + ' after saving your platform-context.json edits.',
    };
  }
  if (hasComponents(kitCtx) && kitCtx.components.some((c) => c && c.platform === from)) {
    return { kind: 'to-composite' };
  }
  // A switch between unrelated kits (ios → python): not a conversion; update proceeds as before.
  return { kind: 'none' };
}

/**
 * Merge one top-level field: the kit's value, with the user's additions kept — arrays as a union
 * (kit order first), objects shallow-merged with the user's keys winning.
 */
function mergeTopLevel(kitValue, userValue) {
  if (Array.isArray(kitValue)) {
    const extra = Array.isArray(userValue) ? userValue.filter((v) => !kitValue.includes(v)) : [];
    return [...kitValue, ...extra];
  }
  if (isPlainObject(kitValue) && isPlainObject(userValue)) return { ...kitValue, ...userValue };
  return kitValue;
}

/**
 * The installed single-kit context rewritten into the composite's shape.
 *
 * @param {{ installedCtx: object, kitCtx: object, projectRoot: string }} p
 * @returns {{ ctx: object, lines: string[], notes: string[] }}
 */
export function convertToComposite({ installedCtx, kitCtx, projectRoot }) {
  const from = installedCtx.platform;
  const detections = detectComponents(projectRoot, kitCtx.components);
  const lines = [];
  const notes = [];

  const components = kitCtx.components.map((template, i) => {
    const d = detections[i];
    if (template.platform !== from) {
      const r = applyComponentDetection(template, d, projectRoot);
      lines.push(`${r.line} (from the ${kitCtx.platform} kit template)`);
      if (r.note) notes.push(r.note);
      return r.component;
    }
    // The user's own context becomes this component: every field they had (commands, dirs,
    // conventions, rules, skills, framework…), except what only the composite's top level holds.
    const own = Object.fromEntries(Object.entries(installedCtx).filter(([k]) => !TOP_LEVEL_ONLY.includes(k) && k !== 'root'));
    // A root the user (or bk init) recorded wins; else the detected one.
    const root = explicitRoot(installedCtx.root) || (d.found ? d.root : '.');
    if (d.found && d.candidates.length > 1 && !explicitRoot(installedCtx.root)) {
      notes.push(`${template.id}: ${template.platform} markers in several dirs (${d.candidates.map(displayRoot).join(', ')}) — using ${displayRoot(root)};`
        + ' edit components[].root in .claude/platform-context.json to change it');
    }
    const kept = ['commands', 'dirs', 'conventions'].filter((k) => k in own);
    lines.push(`${template.id}: ${displayRoot(root)} — your ${from} context kept${kept.length ? ` (${kept.join(', ')})` : ''}`);
    return { ...template, ...own, id: template.id, platform: template.platform, root, present: true };
  });

  const topLevel = {};
  const userKept = [];
  for (const [key, kitValue] of Object.entries(kitCtx)) {
    if (key === 'platform' || key === 'components') continue;
    topLevel[key] = mergeTopLevel(kitValue, installedCtx[key]);
    if (isPlainObject(installedCtx[key]) && Object.keys(installedCtx[key]).some((k) => !(isPlainObject(kitValue) && k in kitValue))) {
      userKept.push(key);
    }
  }
  lines.push(`top level: ${Object.keys(topLevel).join(', ')} from the ${kitCtx.platform} kit`
    + (userKept.length ? `; your own ${userKept.join(', ')} entries kept` : ''));

  return { ctx: { platform: kitCtx.platform, components, ...topLevel }, lines, notes };
}

/**
 * Convert `.claude/platform-context.json` for a kit switch, when one is needed.
 * Backs the file up next to itself before rewriting it; refuses (and writes nothing) for a
 * composite → other-kit switch.
 *
 * @param {{ claudeDir: string, kitDir: string, projectRoot: string }} p
 * @returns {{ status: 'none'|'converted'|'refused', from?: string, to?: string, lines: string[],
 *   notes: string[], message?: string, backupPath?: string }}
 */
export function switchInstalledContext({ claudeDir, kitDir, projectRoot }) {
  const ctxPath = join(claudeDir, 'platform-context.json');
  const none = { status: 'none', lines: [], notes: [] };
  if (!existsSync(ctxPath)) return none;
  let installedCtx;
  let kitCtx;
  try { installedCtx = JSON.parse(readFileSync(ctxPath, 'utf8')); } catch { return none; }
  try { kitCtx = JSON.parse(readFileSync(join(kitDir, 'platform-context.json'), 'utf8')); } catch { return none; }

  const plan = planKitSwitch(installedCtx, kitCtx);
  if (plan.kind === 'refuse') return { ...none, status: 'refused', message: plan.message };
  if (plan.kind !== 'to-composite') return none;

  const { ctx, lines, notes } = convertToComposite({ installedCtx, kitCtx, projectRoot });
  const backupPath = join(claudeDir, backupName(installedCtx.platform));
  copyFileSync(ctxPath, backupPath);
  writeFileSync(ctxPath, JSON.stringify(ctx, null, 2) + '\n', 'utf8');
  return { status: 'converted', from: installedCtx.platform, to: kitCtx.platform, lines, notes, backupPath };
}
