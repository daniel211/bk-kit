/**
 * framework-detector.mjs — which framework variant of the python / web kit fits this project.
 *
 * One kit per language; the framework is a field of `.claude/platform-context.json` (contract:
 * docs/kit-dev/plan-be-web-platforms.md § Phase 2.5). The shipped file holds the generic
 * `commands` / `conventions` at top level and only the differences under `frameworks.<id>`.
 * `bk init` detects, then applies the chosen variant; `/bk-bootstrap` step 7 applies the same
 * precedence from its scan, and `bk doctor` re-detects to spot a project that changed since.
 *
 * Precedence (first match wins):
 *   python  django  — manage.py at the root, or `django` in a dependency file
 *           fastapi — `fastapi` in a dependency file
 *           generic — everything else (Flask, scripts, libraries)
 *   web     next    — next.config.* at the root, or `next` in package.json deps
 *           vite    — vite.config.* at the root, or `vite` in package.json deps. Checked only
 *                     after next: Next + vitest pulls `vite` in too.
 *           generic — everything else (CRA, Remix, webpack)
 *   web testRunner — vitest if in deps, else jest if in deps, else vitest.
 *
 * Dependency files are scanned as text: no TOML parser is shipped, and a dependency name on a
 * line of its own (`django>=5`, `"fastapi[all]"`, `Django = "^5"`) is all detection needs.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyRunner, detectRunner, runnerDifference } from './runner-detector.mjs';

/** Kits that have framework variants. Mobile kits are untouched by everything here. */
export const FRAMEWORK_PLATFORMS = new Set(['python', 'web']);

/** Value written when nothing is detected, and assumed when the field is missing (0.15.0). */
export const GENERIC = 'generic';

/**
 * Web test-runner commands. Not in platform-context.json: the contract names `testRunner` only,
 * and two one-line commands do not earn a second map in the user's file.
 */
export const TEST_RUNNERS = {
  vitest: { commands: { test: 'npx vitest run --coverage' }, conventions: { testFramework: 'vitest + @testing-library/react' } },
  jest: { commands: { test: 'npx jest --coverage' }, conventions: { testFramework: 'jest + @testing-library/react' } },
};

/** Read a file as text, '' when it is missing or unreadable. */
function readText(file) {
  try { return readFileSync(file, 'utf8'); } catch { return ''; }
}

/** Root entries, [] when the directory cannot be read. */
function rootEntries(projectRoot) {
  try { return readdirSync(projectRoot); } catch { return []; }
}

/**
 * Python dependency files at the project root, as { name, text }: pyproject.toml,
 * requirements*.txt (requirements.txt, requirements-dev.txt, ...), Pipfile.
 */
function pythonDependencyFiles(projectRoot) {
  const names = rootEntries(projectRoot)
    .filter((n) => n === 'pyproject.toml' || n === 'Pipfile' || /^requirements[\w.-]*\.txt$/i.test(n))
    .sort();
  return names.map((name) => ({ name, text: readText(join(projectRoot, name)) }));
}

/**
 * Does a dependency file name `pkg`? A tolerant line scan, two shapes:
 *   - the name starts the line: `django>=5` (requirements), `Django = "^5"` (Poetry, Pipfile),
 *     `"django>=5",` (a multi-line PEP 621 list);
 *   - a quoted PEP 508 string anywhere: `dependencies = ["fastapi[all]", "django>=5"]`. Here the
 *     name must be followed by a specifier, extras, marker or the closing quote, so a sentence in
 *     `description = "django helpers"` is not a dependency.
 * Either way the name may not run on, so `django` does not match `django-environ` and `pytest`
 * does not match `pytest-django`. Case and `-_.` are normalised as pip does; comments dropped.
 */
export function mentionsPythonPackage(text, pkg) {
  const name = pkg.replace(/[-_.]+/g, '[-_.]');
  const atStart = new RegExp(`^\\s*["']?${name}(?![\\w.-])`, 'i');
  const quoted = new RegExp(`["']${name}(?=\\s*[<>=!~\\[;,"'])`, 'i');
  return text.split('\n').some((raw) => {
    const line = raw.replace(/#.*$/, '');
    return atStart.test(line) || quoted.test(line);
  });
}

/** The first dependency file naming `pkg`, or null. */
function pythonDepSource(files, pkg) {
  const hit = files.find((f) => mentionsPythonPackage(f.text, pkg));
  return hit ? hit.name : null;
}

/** package.json dependencies + devDependencies (+ peer), {} when absent or invalid. */
function packageDeps(projectRoot) {
  try {
    const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
    return { ...(pkg.peerDependencies || {}), ...(pkg.devDependencies || {}), ...(pkg.dependencies || {}) };
  } catch {
    return {};
  }
}

/** A root file matching `<base>.<ext>` (next.config.mjs, vite.config.ts, ...), or null. */
function rootConfigFile(projectRoot, base) {
  return rootEntries(projectRoot).find((n) => n.startsWith(`${base}.`)) || null;
}

function detectPython(projectRoot) {
  const files = pythonDependencyFiles(projectRoot);
  const evidence = [];

  const hasManagePy = existsSync(join(projectRoot, 'manage.py'));
  const djangoSrc = pythonDepSource(files, 'django');
  if (hasManagePy || djangoSrc) {
    if (hasManagePy) evidence.push('manage.py');
    if (djangoSrc) evidence.push(`django in ${djangoSrc}`);
    // `pytest --cov` needs pytest-django to find the settings; without it the project's own
    // runner is the one that works. A detection-time override, not a variant of its own.
    const result = { framework: 'django', evidence };
    if (!pythonDepSource(files, 'pytest-django')) {
      result.overrides = { commands: { test: 'python manage.py test' } };
      evidence.push('no pytest-django: test = python manage.py test');
    }
    return result;
  }

  const fastapiSrc = pythonDepSource(files, 'fastapi');
  if (fastapiSrc) return { framework: 'fastapi', evidence: [`fastapi in ${fastapiSrc}`] };

  return { framework: GENERIC, evidence };
}

function detectWeb(projectRoot) {
  const deps = packageDeps(projectRoot);
  const evidence = [];
  let framework = GENERIC;

  const nextConfig = rootConfigFile(projectRoot, 'next.config');
  const viteConfig = rootConfigFile(projectRoot, 'vite.config');
  if (nextConfig || deps.next) {
    framework = 'next';
    if (nextConfig) evidence.push(nextConfig);
    if (deps.next) evidence.push('next in package.json');
  } else if (viteConfig || deps.vite) {
    framework = 'vite';
    if (viteConfig) evidence.push(viteConfig);
    if (deps.vite) evidence.push('vite in package.json');
  }

  let testRunner = 'vitest';
  if (deps.vitest) {
    evidence.push('vitest in package.json');
  } else if (deps.jest) {
    testRunner = 'jest';
    evidence.push('jest in package.json');
  }
  return { framework, testRunner, evidence };
}

/**
 * Detect the framework variant of a python / web project.
 *
 * @param {string} platform - kit id; anything but python / web returns null
 * @param {string} projectRoot - absolute project root
 * @returns {{ framework: string, testRunner?: string, overrides?: {commands?: object, conventions?: object},
 *   evidence: string[] }|null}
 *   `evidence` names what decided it ([] for a generic python project); `overrides` carries
 *   detection-time command changes applyFramework() lays over the variant.
 */
export function detectFramework(platform, projectRoot) {
  if (platform === 'python') return detectPython(projectRoot);
  if (platform === 'web') return detectWeb(projectRoot);
  return null;
}

/**
 * Apply a framework variant to a platform context. Pure: returns a new object.
 *
 * Shallow merge, in order: the context's top-level `commands` / `conventions`, then
 * `frameworks[framework]`, then the web test runner, then `overrides`. `framework` (and
 * `testRunner` when given) are set; the `frameworks` map is kept as is. An unknown framework id
 * or `generic` merges nothing from the map.
 *
 * Meant for a context whose top level is still the generic set (a fresh install): applied over an
 * already-applied context, keys only the previous variant had (say fastapi's `migrate`) remain.
 *
 * @param {object} ctx - parsed platform-context.json
 * @param {{ framework: string, testRunner?: string, overrides?: {commands?: object, conventions?: object} }} choice
 * @returns {object}
 */
export function applyFramework(ctx, { framework, testRunner, overrides } = {}) {
  const fw = framework || GENERIC;
  const variant = (fw !== GENERIC && ctx.frameworks && ctx.frameworks[fw]) || {};
  const runner = (testRunner && TEST_RUNNERS[testRunner]) || {};
  const layers = [variant, runner, overrides || {}];

  const out = { ...ctx, framework: fw };
  if (testRunner) out.testRunner = testRunner;
  out.commands = Object.assign({}, ctx.commands, ...layers.map((l) => l.commands || {}));
  out.conventions = Object.assign({}, ctx.conventions, ...layers.map((l) => l.conventions || {}));
  return out;
}

/**
 * The framework ids `--framework` accepts for an installed context: the keys of its
 * `frameworks` map plus `generic`.
 *
 * @param {object} ctx
 * @returns {string[]}
 */
export function knownFrameworks(ctx) {
  return [...Object.keys((ctx && ctx.frameworks) || {}), GENERIC];
}

/**
 * One line for the user: `django (manage.py, django in requirements.txt)`, or the generic
 * fallback that says how to set it.
 *
 * @param {{framework: string, testRunner?: string, evidence?: string[]}} detected
 * @param {{forced?: boolean}} [opts]
 * @returns {string}
 */
export function describeFramework(detected, { forced = false } = {}) {
  const runner = detected.testRunner ? `, tests: ${detected.testRunner}` : '';
  if (forced) return `${detected.framework} (set by --framework${runner})`;
  if (detected.framework === GENERIC) {
    return `${GENERIC} — not detected; /bk-bootstrap or --framework can set it${runner ? ` (${runner.slice(2)})` : ''}`;
  }
  const why = (detected.evidence || []).join(', ');
  return `${detected.framework} (${why})`;
}

/**
 * Check a `--framework` value against the kit's own `frameworks` map before anything is
 * written. Undefined passes through; a mobile kit or an unknown id throws.
 *
 * @param {string} platform
 * @param {object|null} kitCtx - the kit's shipped platform-context.json, parsed
 * @param {string|undefined} explicit
 * @returns {string|null} the id to force, or null to detect
 */
export function resolveFrameworkOption(platform, kitCtx, explicit) {
  if (explicit === undefined || explicit === null) return null;
  if (!FRAMEWORK_PLATFORMS.has(platform)) {
    throw new Error(`--framework applies to the python and web kits only (this is the ${platform} kit)`);
  }
  const id = String(explicit).trim().toLowerCase();
  const known = knownFrameworks(kitCtx);
  if (!known.includes(id)) {
    throw new Error(`unknown --framework "${explicit}" for the ${platform} kit (one of: ${known.join(', ')})`);
  }
  return id;
}

/**
 * The framework choice for a dir: the forced id (still taking the detected test runner, and the
 * detected overrides only when detection agrees — a forced django on a project with no manage.py
 * gets plain django), else the detection.
 */
export function chooseFramework(detected, forced) {
  return forced
    ? { framework: forced, testRunner: detected.testRunner, overrides: detected.framework === forced ? detected.overrides : undefined }
    : detected;
}

/**
 * Framework variant, then the project's runner (runner-detector), for one context detected at
 * `dir`. Pure apart from reading `dir`. Shared by single kits and fullstack components so both
 * apply the two steps in the same order, once.
 *
 * @returns {{ ctx: object, choice: object, detected: object, runner: string|null, line: string }}
 */
export function applyFrameworkAndRunner(ctx, platform, dir, forced = null) {
  const detected = detectFramework(platform, dir);
  const choice = chooseFramework(detected, forced);
  const rule = detectRunner(platform, dir);
  const out = applyRunner(applyFramework(ctx, choice), rule);
  const line = describeFramework({ ...detected, framework: choice.framework }, { forced: Boolean(forced) })
    + (rule ? `, runner: ${rule.runner}` : '');
  return { ctx: out, choice, detected, runner: rule ? rule.runner : null, line };
}

/**
 * Detect (or take the forced id), apply and write back an installed platform-context.json.
 * `root` (relative to projectRoot, default '.') is where the markers sit: it is written as the
 * top-level `root`, and framework + runner are detected there.
 *
 * @param {{ ctxPath: string, platform: string, projectRoot: string, root?: string, forced?: string|null }} p
 * @returns {{ framework: string, testRunner?: string, runner: string|null, root: string, line: string }|null}
 *   null for mobile kits or an unreadable context (init's doctor run reports the latter)
 */
export function applyFrameworkToInstalledContext({ ctxPath, platform, projectRoot, root = '.', forced = null }) {
  if (!FRAMEWORK_PLATFORMS.has(platform)) return null;
  let ctx;
  try { ctx = JSON.parse(readFileSync(ctxPath, 'utf8')); } catch { return null; }

  const r = applyFrameworkAndRunner(ctx, platform, join(projectRoot, root), forced);
  writeFileSync(ctxPath, JSON.stringify({ ...r.ctx, root }, null, 2) + '\n', 'utf8');
  return { framework: r.choice.framework, testRunner: r.choice.testRunner, runner: r.runner, root, line: r.line };
}

/**
 * What `bk doctor` reports: the recorded framework (missing = generic, as installed by 0.15.0)
 * against a fresh detection, and the recorded package runner likewise. A difference is information — the project may have moved on, or
 * the user chose on purpose — so the caller warns, never fails.
 *
 * @param {object} ctx - parsed installed platform-context.json
 * @param {string} platform
 * @param {string} projectRoot
 * @returns {{ recorded: string, recordedRunner: string|null, detected: object, differences: string[] }|null}
 *   null for mobile kits
 */
export function compareRecordedFramework(ctx, platform, projectRoot) {
  if (!FRAMEWORK_PLATFORMS.has(platform)) return null;
  const recorded = (ctx && typeof ctx.framework === 'string' && ctx.framework) || GENERIC;
  const recordedRunner = (ctx && typeof ctx.testRunner === 'string' && ctx.testRunner) || null;
  const detected = detectFramework(platform, projectRoot);
  const differences = [];
  if (detected.framework !== recorded) differences.push(`framework: recorded ${recorded}, detected ${describeFramework(detected)}`);
  if (recordedRunner && detected.testRunner && detected.testRunner !== recordedRunner) {
    differences.push(`testRunner: recorded ${recordedRunner}, detected ${detected.testRunner}`);
  }
  const runner = runnerDifference(ctx, platform, projectRoot);
  if (runner) differences.push(runner);
  return { recorded, recordedRunner, detected, differences };
}
