/**
 * installed-context-detection.mjs — fold the project's detection results into an installed
 * `.claude/platform-context.json`, at `bk init` and again whenever `bk update` installs a new copy
 * of the kit template over it.
 *
 * The file the kit ships is a template: `root` is `.`, the framework is `generic`, the commands
 * are the bare ones. `bk init` writes the project's values into it (python / web: `root`, framework
 * variant, package runner; composites: each component's `root`, `present`, framework, runner) and
 * records the hash of the file as written. `bk update` replaces an unedited file with the new
 * template when the kit's template changes (safe_update) — and before this module it stopped
 * there, so every detected value fell back to the template's: lint and build ran in `.` instead of
 * `backend/`. Now update carries over what the previous file recorded and re-applies it on top of
 * the new template (reapplyInstalledContext), through the same functions init uses.
 *
 * Carry-over rules (previous file parsed, same kit):
 *   single python / web — previous `root` and `framework` (forced, so the variant's commands are
 *     re-merged over the new template; a framework id the new template no longer knows, or a
 *     missing one, is detected instead);
 *   composite — per component, matched by `id`: previous `root`, `present`, framework. A component
 *     the previous file did not have is detected afresh;
 *   mobile_native single kits — nothing to carry: the template is installed as is.
 * Runner (and the web testRunner) are RE-DERIVED at the carried root, not carried: they are a pure
 * function of the lockfile there, init derives them the same way, and the runner rewrite of the
 * commands has to be redone over the new template anyway — that needs the lockfile's rule, not the
 * recorded name. Re-deriving therefore yields exactly what init would write for the same root.
 * Previous file missing, unparsable, or from a different kit: fresh detection, as init does.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FRAMEWORK_PLATFORMS, applyFrameworkToInstalledContext, knownFrameworks } from './framework-detector.mjs';
import {
  applyComponentDetection, applyComponentsToInstalledContext, detectComponentRoot, detectComponents, displayRoot,
  hasComponents,
} from './component-detector.mjs';

/** The installed file this module manages, relative to .claude/. */
export const PLATFORM_CONTEXT = 'platform-context.json';

/**
 * Init's detection step: python / web root + framework + runner, or every component of a
 * composite. Mobile single kits: both null.
 *
 * @param {{ ctxPath: string, platform: string, projectRoot: string,
 *   forced?: string|Record<string,string>|null }} p — forced: init's validated --framework
 * @returns {{ single: (ReturnType<typeof applyFrameworkToInstalledContext> & { candidates: string[] })|null,
 *   comps: { lines: string[], notes: string[] }|null }}
 */
export function detectIntoInstalledContext({ ctxPath, platform, projectRoot, forced = null }) {
  const found = FRAMEWORK_PLATFORMS.has(platform) ? detectComponentRoot(projectRoot, platform) : null;
  const fw = applyFrameworkToInstalledContext({
    ctxPath, platform, projectRoot, root: found ? found.root : '.', forced: typeof forced === 'string' ? forced : null,
  });
  // A composite: applyFrameworkToInstalledContext returned null above (not a python / web kit).
  const comps = applyComponentsToInstalledContext({
    ctxPath, projectRoot, forced: forced && typeof forced === 'object' ? forced : null,
  });
  return { single: fw ? { ...fw, candidates: found.candidates } : null, comps };
}

/** Parsed JSON object, or null when the text is missing / not a JSON object. */
export function parseContext(text) {
  if (typeof text !== 'string') return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch { return null; }
}

/** A recorded root, or null when there is none to carry. */
function recordedRoot(ctx) {
  return ctx && typeof ctx.root === 'string' && ctx.root.trim() ? ctx.root : null;
}

/** A recorded framework id the new template still knows, or null (= detect). */
function recordedFramework(prev, template) {
  const id = prev && typeof prev.framework === 'string' ? prev.framework : null;
  return id && knownFrameworks(template).includes(id) ? id : null;
}

/** `fastapi, runner uv` / `` — the framework part of a summary line. */
function fwPart(c) {
  if (!c.framework) return '';
  return `, framework ${c.framework}${c.runner ? `, runner ${c.runner}` : ''}`;
}

/** Composite: each component of the new template with the previous file's values re-applied. */
function carryComponents(ctxPath, ctx, prev, projectRoot) {
  const prevById = new Map((Array.isArray(prev.components) ? prev.components : [])
    .filter((c) => c && typeof c.id === 'string').map((c) => [c.id, c]));
  const fresh = detectComponents(projectRoot, ctx.components);
  const parts = [];
  const components = ctx.components.map((template, i) => {
    const p = prevById.get(template.id);
    let d = fresh[i];
    let forcedId = null;
    let how = 'detected';
    if (p && (!p.platform || p.platform === template.platform)) {
      how = 'kept';
      if (p.present === false) d = { ...d, root: '.', found: false, candidates: [] };
      else d = { ...d, root: recordedRoot(p) || d.root, found: true, candidates: [] };
      forcedId = FRAMEWORK_PLATFORMS.has(template.platform) ? recordedFramework(p, template) : null;
    }
    const out = applyComponentDetection(template, d, projectRoot, forcedId).component;
    parts.push(out.present === false
      ? `${template.id} not present (${how})`
      : `${template.id} ${displayRoot(out.root)}${fwPart(out)} (${how})`);
    return out;
  });
  writeFileSync(ctxPath, JSON.stringify({ ...ctx, components }, null, 2) + '\n', 'utf8');
  return parts.join('; ');
}

/**
 * After `bk update` installed the kit's template at `ctxPath`: re-apply the project's detection
 * results, carried over from `previousText` (the file as it was before the install).
 *
 * @param {{ ctxPath: string, projectRoot: string, previousText?: string|null }} p
 * @returns {{ mode: 'carried'|'detected'|'none', summary: string|null }}
 *   'none': nothing to apply (mobile_native single kit, unreadable template); summary is one line
 */
export function reapplyInstalledContext({ ctxPath, projectRoot, previousText = null }) {
  const ctx = parseContext(readTextOrNull(ctxPath));
  if (!ctx) return { mode: 'none', summary: null };
  const platform = ctx.platform;
  let prev = parseContext(previousText);
  // A different kit's file (ios → python with no conversion) has nothing this kit can use.
  if (prev && prev.platform && platform && prev.platform !== platform) prev = null;

  if (!prev) {
    const { single, comps } = detectIntoInstalledContext({ ctxPath, platform, projectRoot });
    if (single) return { mode: 'detected', summary: `root ${displayRoot(single.root)}${fwPart(single)}` };
    if (comps) return { mode: 'detected', summary: comps.lines.join('; ') };
    return { mode: 'none', summary: null };
  }

  if (hasComponents(ctx)) {
    return { mode: 'carried', summary: carryComponents(ctxPath, ctx, prev, projectRoot) };
  }
  if (!FRAMEWORK_PLATFORMS.has(platform)) return { mode: 'none', summary: null };
  const root = recordedRoot(prev) || detectComponentRoot(projectRoot, platform).root;
  const r = applyFrameworkToInstalledContext({
    ctxPath, platform, projectRoot, root, forced: recordedFramework(prev, ctx),
  });
  return r ? { mode: 'carried', summary: `root ${displayRoot(r.root)}${fwPart(r)}` } : { mode: 'none', summary: null };
}

/** File text, or null when it cannot be read. */
export function readTextOrNull(path) {
  try { return readFileSync(path, 'utf8'); } catch { return null; }
}
