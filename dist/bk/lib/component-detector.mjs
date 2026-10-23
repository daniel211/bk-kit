/**
 * component-detector.mjs — roots and framework variants of a composite kit's components.
 *
 * The fullstack kit ships `.claude/platform-context.json` with `components: [{ id, platform,
 * root: '.', framework: 'generic', frameworks, commands, ... }]` (contract:
 * docs/kit-dev/plan-be-web-platforms.md § Phase 4, Runtime). `bk init` sets each component's
 * `root` — the root or the first-level subdir carrying that platform's markers (the same marker
 * sets kit-resolver uses) — and then its framework variant, detected at that root with the
 * python / web detector, and its package runner (runner-detector). A component with no markers
 * gets `present: false`. The single-platform python / web kits use detectComponentRoot() for their
 * top-level `root` too (Phase 4.1). `bk doctor` re-checks all of it; `/bk-bootstrap` step 7 applies
 * the same rules.
 *
 * Root choice when several dirs carry a platform's markers (kit-resolver pickMarkerDir):
 *   1. a conventional subdir name (python: backend, api, server; web: frontend, web, client, app),
 *      in that order — a root package.json is often workspace tooling next to a real frontend/;
 *   2. else the root itself;
 *   3. else the first subdir alphabetically.
 * Anything but a single candidate is reported as an ambiguity.
 */

import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONVENTIONAL_DIRS, pickMarkerDir, platformMarkerDirs } from './kit-resolver.mjs';
import {
  applyFrameworkAndRunner, compareRecordedFramework, detectFramework, knownFrameworks,
} from './framework-detector.mjs';

export { CONVENTIONAL_DIRS };

/** True for a context composed of components (the fullstack kit). */
export function hasComponents(ctx) {
  return Boolean(ctx) && Array.isArray(ctx.components) && ctx.components.length > 0;
}

/** True when `dir` exists and is a directory. */
export function dirExists(dir) {
  try { return existsSync(dir) && statSync(dir).isDirectory(); } catch { return false; }
}

/** `.` -> `./`, `backend` -> `backend/`, as printed to the user. */
export function displayRoot(root) {
  return root === '.' ? './' : `${root}/`;
}

/**
 * The root of one platform's component.
 *
 * @param {string} projectRoot
 * @param {string} platform
 * @returns {{ root: string, marker: string|null, found: boolean, candidates: string[] }}
 *   `found` false = no markers anywhere (root '.', marker null); `candidates` lists every dir
 *   that qualified, for the ambiguity note
 */
export function detectComponentRoot(projectRoot, platform) {
  const hits = platformMarkerDirs(projectRoot, platform);
  if (hits.length === 0) return { root: '.', marker: null, found: false, candidates: [] };
  const pick = pickMarkerDir(platform, hits);
  return { root: pick.dir, marker: pick.marker, found: true, candidates: hits.map((h) => h.dir) };
}

/**
 * Detect root + framework of every component of a composite kit.
 *
 * @param {string} projectRoot
 * @param {Array<{id: string, platform: string}>} componentsFromKit
 * @returns {Array<{ id: string, platform: string, root: string, found: boolean, marker: string|null,
 *   candidates: string[], detected: object|null }>} `detected` is detectFramework()'s result at
 *   the component root (null for a platform without framework variants)
 */
export function detectComponents(projectRoot, componentsFromKit) {
  return (componentsFromKit || []).map((c) => {
    const r = detectComponentRoot(projectRoot, c.platform);
    const detected = r.found ? detectFramework(c.platform, join(projectRoot, r.root)) : null;
    return { id: c.id, platform: c.platform, ...r, detected };
  });
}

/**
 * Parse and validate `--framework` for a composite kit: `python=django,web=next`.
 * Keys are component platforms; each value must be one of that component's `frameworks` keys
 * or generic. A key may be left out (that component is detected). Throws on anything else.
 *
 * @param {object|null} kitCtx - the kit's shipped platform-context.json, parsed
 * @param {string|undefined} explicit
 * @returns {Record<string, string>|null} platform -> forced id, or null to detect everything
 */
export function resolveComponentFrameworkOption(kitCtx, explicit) {
  if (explicit === undefined || explicit === null) return null;
  const components = (kitCtx && kitCtx.components) || [];
  const platforms = components.map((c) => c.platform);
  const example = platforms.map((p) => `${p}=<id>`).join(',');
  const forced = {};
  for (const part of String(explicit).split(',').map((p) => p.trim()).filter(Boolean)) {
    const eq = part.indexOf('=');
    if (eq < 0) {
      throw new Error(`--framework for the ${kitCtx.platform} kit takes one value per component: ${example} (got "${part}")`);
    }
    const platform = part.slice(0, eq).trim().toLowerCase();
    const id = part.slice(eq + 1).trim().toLowerCase();
    const component = components.find((c) => c.platform === platform);
    if (!component) {
      throw new Error(`--framework: no "${platform}" component in the ${kitCtx.platform} kit (keys: ${platforms.join(', ')})`);
    }
    const known = knownFrameworks(component);
    if (!known.includes(id)) {
      throw new Error(`unknown --framework "${platform}=${id}" (${platform}: one of ${known.join(', ')})`);
    }
    forced[platform] = id;
  }
  if (Object.keys(forced).length === 0) throw new Error(`--framework is empty (expected ${example})`);
  return forced;
}

/**
 * Detect, apply and write back the components of an installed composite platform-context.json.
 * A component with markers gets `root`, `present: true`, then its framework variant and runner
 * (applyFrameworkAndRunner — the same steps the single-platform kits take). A component with no
 * markers anywhere gets `present: false` and is otherwise left as shipped: hooks skip it until
 * /bk-bootstrap finds its markers (contract § Phase 4.1 item 5). `frameworks` maps are kept.
 *
 * @param {{ ctxPath: string, projectRoot: string, forced?: Record<string,string>|null }} p
 * @returns {{ lines: string[], notes: string[] }|null} null when the context has no components
 *   or cannot be read (init's doctor run reports the latter)
 */
export function applyComponentsToInstalledContext({ ctxPath, projectRoot, forced = null }) {
  let ctx;
  try { ctx = JSON.parse(readFileSync(ctxPath, 'utf8')); } catch { return null; }
  if (!hasComponents(ctx)) return null;

  const detections = detectComponents(projectRoot, ctx.components);
  const lines = [];
  const notes = [];
  const components = ctx.components.map((component, i) => {
    const d = detections[i];
    if (!d.found) {
      lines.push(`${d.id}: not present — no ${d.platform} markers at the root or in a first-level subdir;`
        + ' hooks skip it until /bk-bootstrap finds them');
      return { ...component, present: false };
    }
    const forcedId = (forced && forced[component.platform]) || null;
    const r = applyFrameworkAndRunner({ ...component, root: d.root, present: true }, component.platform, join(projectRoot, d.root), forcedId);
    lines.push(`${d.id}: ${displayRoot(d.root)} — ${r.line}`);
    if (d.candidates.length > 1) {
      notes.push(`${d.id}: ${d.platform} markers in several dirs (${d.candidates.map(displayRoot).join(', ')}) — using ${displayRoot(d.root)};`
        + ' edit components[].root in .claude/platform-context.json to change it');
    }
    return r.ctx;
  });
  writeFileSync(ctxPath, JSON.stringify({ ...ctx, components }, null, 2) + '\n', 'utf8');
  return { lines, notes };
}

/**
 * What `bk doctor` checks per component: the recorded root exists, and the recorded framework
 * against a fresh detection at that root.
 *
 * @param {object} ctx - parsed installed platform-context.json with `components`
 * @param {string} projectRoot
 * A `present: false` component is reported as such and not checked further.
 *
 * @returns {Array<{ id: string, platform: string, root: string, present: boolean, rootExists: boolean,
 *   framework: ReturnType<typeof compareRecordedFramework> }>}
 */
export function checkComponents(ctx, projectRoot) {
  if (!hasComponents(ctx)) return [];
  return ctx.components.map((c) => {
    const root = typeof c.root === 'string' && c.root ? c.root : '.';
    if (c.present === false) return { id: c.id, platform: c.platform, root, present: false, rootExists: false, framework: null };
    const dir = join(projectRoot, root);
    const rootExists = dirExists(dir);
    return {
      id: c.id,
      platform: c.platform,
      root,
      present: true,
      rootExists,
      framework: rootExists ? compareRecordedFramework(c, c.platform, dir) : null,
    };
  });
}
