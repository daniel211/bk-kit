'use strict';
/**
 * component-resolver.cjs — which component of a composite kit a file belongs to.
 *
 * A composite kit (`fullstack` = python + web, `mobile_native` = ios + android) installs a
 * platform-context.json with `platform: "<composite>"` and a `components[]` list:
 * `{ id, platform, root, framework?, commands }` per stack (docs/kit-dev/plan-be-web-platforms.md
 * Phase 4 contract item 2; docs/kit-dev/plan-mobile-composite.md §3). `root` is relative to the
 * project root (`.`, `backend`, `MeetupLiveTracking`) and is filled by `bk init` / `/bk-bootstrap`.
 *
 * Hooks that act per stack (lint batch, descriptive-name, the subagent digest, arch-fitness,
 * native lint, ui-snapshot) resolve a file to its component here instead of trusting the kit-wide
 * `{{platform}}`, which is the composite's id.
 *
 * File → component: among the components whose root is a prefix of the file's path AND whose
 * platform owns the file's extension (OWNED_EXTENSIONS — the lint-queue LINTABLE_EXTENSIONS, plus
 * the Objective-C sources/headers for ios: `.py` → python, `.ts/.tsx/…` → web, `.swift/.m/.h` →
 * ios, `.kt/.kts/.java` → android), the longest root wins. No match → null (the file belongs to
 * no component and is neither linted nor name-checked).
 *
 * Fail-open everywhere: an unreadable or malformed context gives null, never a throw.
 *
 * Exports:
 *   COMPOSITE_PLATFORMS        — composite platform → its components ({ id, platform })
 *   isComposite(platform), defaultComponents(platform), ownedExtensions(platform)
 *   readComponents(projectRoot)            — present components[] (non-composite: one implicit
 *                                            component rooted at ctx.root), or null
 *   componentForFile(absPath, projectRoot) — the owning component, or null
 *   componentCwd(component, projectRoot)   — absolute working dir of a component
 *   fileBelongsToPlatform(absPath, projectRoot, platform) — false only when a composite context
 *                                            gives the file to another component (or to none)
 */

const fs = require('fs');
const path = require('path');

/**
 * Composite platforms and their component platforms, in manifest order. Mirrors
 * `platforms.<id>.components` in bk-manifest.json — the runtime has no manifest, and the list
 * only matters before a platform-context.json is readable (isComposite, digest fallback).
 */
const COMPOSITE_PLATFORMS = {
  fullstack: [{ id: 'backend', platform: 'python' }, { id: 'frontend', platform: 'web' }],
  mobile_native: [{ id: 'ios', platform: 'ios' }, { id: 'android', platform: 'android' }]
};

/**
 * Extensions a component platform owns beyond what its linter reads: Objective-C sources and
 * headers belong to the ios component (swiftlint does not read them, so they are never queued
 * for lint — lint-queue.isLintable checks LINTABLE_EXTENSIONS of the owning platform).
 */
const EXTRA_OWNED_EXTENSIONS = {
  ios: ['.m', '.mm', '.h']
};

/**
 * Components as the kit ships them (every root `.`) — what a composite project has before
 * `bk init` sets the roots, and the fallback when no context is readable for a digest.
 */
function defaultComponents(platform) {
  return (COMPOSITE_PLATFORMS[platform] || []).map((c) => ({ ...c, root: '.' }));
}

/** @returns {boolean} */
function isComposite(platform) {
  return Object.prototype.hasOwnProperty.call(COMPOSITE_PLATFORMS, String(platform || ''));
}

/** Where an installed kit keeps its platform-context.json (same order as bk-config-utils). */
function contextCandidates(projectRoot) {
  return [
    path.join(projectRoot, '.claude', 'platform-context.json'),
    path.join(projectRoot, 'bk', 'dev', 'shared', 'platform-context.json')
  ];
}

/**
 * Normalise a component root: '' / './' / 'backend/' → '.' / '.' / 'backend'. A root that
 * leaves the project (absolute, or a `..` segment) is invalid → null, and the component is
 * dropped: lint runs with cwd = root, so it must stay inside the project.
 */
function normaliseRoot(root) {
  const raw = typeof root === 'string' ? root.trim() : '';
  const cleaned = raw.replace(/\\/g, '/').replace(/^(\.\/+)+/, '').replace(/\/+$/, '');
  if (cleaned === '' || cleaned === '.') return '.';
  if (cleaned.startsWith('/') || /^[A-Za-z]:/.test(cleaned) || cleaned.split('/').includes('..')) return null;
  return cleaned;
}

/**
 * The project's components. A composite context returns its present `components[]` (each with
 * a normalised `root`; [] when every one is `present: false`); a plain one returns a single
 * implicit `{ id, platform, root }` (root = its top-level `root`, default `.`) so callers can
 * treat every kit the same way. null = no usable context.
 * @param {string} projectRoot
 * @returns {Array<{id: string, platform: string, root: string, framework?: string, commands?: object}>|null}
 */
function readComponents(projectRoot) {
  if (!projectRoot || typeof projectRoot !== 'string') return null;
  let ctx = null;
  for (const file of contextCandidates(projectRoot)) {
    try {
      if (!fs.existsSync(file)) continue;
      ctx = JSON.parse(fs.readFileSync(file, 'utf8'));
      break;
    } catch {
      return null; // present but unreadable / malformed — fail-open
    }
  }
  if (!ctx || typeof ctx !== 'object') return null;

  if (Array.isArray(ctx.components)) {
    const list = ctx.components
      .filter((c) => c && typeof c === 'object' && typeof c.platform === 'string' && c.platform)
      .map((c) => ({ ...c, id: String(c.id || c.platform), root: normaliseRoot(c.root) }))
      .filter((c) => c.root !== null);
    if (list.length === 0) return null;
    // `present: false` = `bk init` found no markers for it (Phase 4.1 item 5): no file belongs
    // to it, it is not linted and the digest does not list it. A missing field = present.
    return list.filter((c) => c.present !== false);
  }
  if (typeof ctx.platform !== 'string' || !ctx.platform) return null;
  // A single-stack kit is one component rooted at its top-level `root` (`backend` for a uv
  // backend/ with nothing at the root; default `.`). An escaping root drops it, as above.
  const root = normaliseRoot(ctx.root);
  if (root === null) return null;
  return [{
    id: ctx.platform,
    platform: ctx.platform,
    root,
    framework: ctx.framework,
    commands: ctx.commands
  }];
}

/** Extensions a component platform owns — the lint-queue list (not a second copy) + EXTRA_OWNED. */
function ownedExtensions(platform) {
  // Required lazily: lint-queue.isLintable requires this module back for composite kits.
  const { LINTABLE_EXTENSIONS } = require('./lint-queue.cjs');
  return [...(LINTABLE_EXTENSIONS[platform] || []), ...(EXTRA_OWNED_EXTENSIONS[platform] || [])];
}

/**
 * The component that owns a file: longest root prefix whose platform reads the extension.
 * @param {string} absPath — absolute (a relative path is resolved against projectRoot)
 * @param {string} projectRoot
 * @returns {object|null}
 */
function componentForFile(absPath, projectRoot) {
  try {
    if (!absPath || typeof absPath !== 'string') return null;
    const components = readComponents(projectRoot);
    if (!components) return null;
    const abs = path.isAbsolute(absPath) ? absPath : path.join(projectRoot, absPath);
    const rel = path.relative(projectRoot, abs).split(path.sep).join('/');
    if (!rel || rel.startsWith('../') || rel === '..' || path.isAbsolute(rel)) return null;
    const ext = path.extname(abs).toLowerCase();

    let best = null;
    for (const c of components) {
      const inRoot = c.root === '.' || rel === c.root || rel.startsWith(`${c.root}/`);
      if (!inRoot || !ownedExtensions(c.platform).includes(ext)) continue;
      const depth = c.root === '.' ? 0 : c.root.length;
      if (!best || depth > best.depth) best = { c, depth };
    }
    return best ? best.c : null;
  } catch {
    return null;
  }
}

/** Absolute working directory of a component. */
function componentCwd(component, projectRoot) {
  const root = normaliseRoot(component && component.root);
  return root === '.' || root === null ? projectRoot : path.join(projectRoot, root);
}

/**
 * Should a per-platform hook (arch-fitness-ios*, arch-fitness-android*) examine this file?
 * Only a composite context can say no: there the file must belong to a present component of
 * `platform` (a `.swift` file outside the ios root, or with the ios component `present: false`,
 * is no file of the ios component). A single kit, or no readable context, keeps the hook's own
 * extension gate — fail-open, the behaviour before composites existed.
 * @param {string} absPath
 * @param {string} projectRoot
 * @param {string} platform
 * @returns {boolean}
 */
function fileBelongsToPlatform(absPath, projectRoot, platform) {
  try {
    if (!projectRoot) return true;
    let composite = false;
    for (const file of contextCandidates(projectRoot)) {
      if (!fs.existsSync(file)) continue;
      const ctx = JSON.parse(fs.readFileSync(file, 'utf8'));
      composite = Boolean(ctx) && Array.isArray(ctx.components);
      break;
    }
    if (!composite) return true;
    const component = componentForFile(absPath, projectRoot);
    return Boolean(component) && component.platform === platform;
  } catch {
    return true;
  }
}

module.exports = {
  COMPOSITE_PLATFORMS,
  isComposite,
  defaultComponents,
  ownedExtensions,
  readComponents,
  componentForFile,
  componentCwd,
  fileBelongsToPlatform
};
