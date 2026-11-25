/**
 * detekt-config-detector.cjs — Is detekt actually configured for an Android component?
 *
 * Field review 2026-11-25 (X-Game-Pro, mobile_native 0.19.0): detection used to answer
 * "detekt available" for any tree with a `gradlew`. X-Game-Pro lints with ktlint only — its
 * Gradle files say "No detekt in M1" — so every .kt edit was deferred to native-lint-flush,
 * `./gradlew detekt …` failed with "Task 'detekt' not found", produced no report, and the
 * failure read as a clean pass: zero rows in native-lint-android.jsonl over the whole review,
 * no advisory, and the regex fallback skipped because the tool looked available.
 *
 * Detection now has to find detekt itself, cheaply — no Gradle run on the hook path (a
 * `./gradlew tasks` costs seconds and a daemon), only bounded file reads:
 *   1. gradle — `gradlew` in the component root AND the detekt Gradle plugin referenced in its
 *      build: settings/build scripts at the root and one module level down, convention plugins
 *      under build-logic/ or buildSrc/, or the version catalog (gradle/libs.versions.toml).
 *      Comments are stripped first, so "// No detekt in M1" or a commented-out plugin line is
 *      not configuration.
 *   2. cli — a standalone `detekt` binary on PATH (Homebrew/SDKMAN install), found by walking
 *      PATH in-process rather than spawning `which` or the JVM for `--version`.
 * A version-catalog entry that no build file applies still counts: that false positive is
 * rare, and runTool now reports a failed run as a tool failure rather than a pass.
 *
 * Exports: detectDetekt(root), findDetektPlugin(root), findDetektOnPath(), stripComments(text, ext)
 */

'use strict';

const fs   = require('fs');
const path = require('path');

/** The plugin id, legacy (io.gitlab.arturbosch.detekt) and 2.x (dev.detekt). */
const PLUGIN_ID_RE = /io\.gitlab\.arturbosch\.detekt|["']dev\.detekt["']/;
/**
 * A build-script use of the plugin without its id: `alias(libs.plugins.detekt)`, the
 * `detekt { … }` extension block, or a convention plugin's `apply<DetektPlugin>()`.
 */
const BUILD_REF_RE = /\bplugins\.detekt\b|^\s*detekt\s*\{|\bDetektPlugin\b|\bDetekt\b(?:>|\(|::)/m;

const BUILD_SCRIPTS = ['settings.gradle.kts', 'settings.gradle', 'build.gradle.kts', 'build.gradle'];
const MODULE_SCRIPTS = ['build.gradle.kts', 'build.gradle'];
const CONVENTION_DIRS = ['build-logic', 'buildSrc'];
const CONVENTION_EXTS = ['.kts', '.gradle', '.kt', '.toml'];
/** Directories one level down that are never modules — skipped without a stat of their scripts. */
const NON_MODULE_DIRS = new Set(['build', 'gradle', '.gradle', '.idea', 'node_modules', '.git', ...CONVENTION_DIRS]);

/** Bounds: the scan runs on the PostToolUse path (cached 5 min), so it must stay a handful of reads. */
const MAX_FILE_BYTES = 256 * 1024;
const MAX_FILES_SCANNED = 200;
const MAX_CONVENTION_DEPTH = 6;

/**
 * Drop comments so only live configuration is matched. Gradle/Kotlin: block and line comments
 * (a `//` right after `:` is a URL, not a comment); TOML: `#` to end of line.
 * @param {string} text
 * @param {string} ext — the file extension, '.toml' or anything else
 * @returns {string}
 */
function stripComments(text, ext) {
  if (ext === '.toml') return text.replace(/#.*$/gm, '');
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Read a file if it exists and is small enough; null otherwise. */
function readBounded(file) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > MAX_FILE_BYTES) return null;
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/** Does this file configure the detekt plugin? */
function fileReferencesDetekt(file) {
  const raw = readBounded(file);
  if (raw === null) return false;
  const ext = path.extname(file).toLowerCase();
  const text = stripComments(raw, ext);
  if (ext === '.toml') return PLUGIN_ID_RE.test(text);
  return PLUGIN_ID_RE.test(text) || BUILD_REF_RE.test(text);
}

/** Convention-plugin sources under build-logic/ or buildSrc/, depth- and count-bounded. */
function conventionFiles(dir, depth, out) {
  if (depth > MAX_CONVENTION_DEPTH || out.length >= MAX_FILES_SCANNED) return out;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (out.length >= MAX_FILES_SCANNED) break;
    if (e.isDirectory()) {
      if (e.name === 'build' || e.name.startsWith('.')) continue;
      conventionFiles(path.join(dir, e.name), depth + 1, out);
    } else if (CONVENTION_EXTS.includes(path.extname(e.name).toLowerCase())) {
      out.push(path.join(dir, e.name));
    }
  }
  return out;
}

/**
 * The first Gradle file under `root` that configures detekt, or null.
 * @param {string} root — the Android component root (the dir holding gradlew)
 * @returns {string|null}
 */
function findDetektPlugin(root) {
  const candidates = [
    ...BUILD_SCRIPTS.map((f) => path.join(root, f)),
    path.join(root, 'gradle', 'libs.versions.toml')
  ];
  try {
    for (const e of fs.readdirSync(root, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith('.') || NON_MODULE_DIRS.has(e.name)) continue;
      for (const f of MODULE_SCRIPTS) candidates.push(path.join(root, e.name, f));
    }
  } catch { /* unreadable root: the root scripts above are all we can check */ }
  for (const dir of CONVENTION_DIRS) conventionFiles(path.join(root, dir), 0, candidates);

  for (const file of candidates.slice(0, MAX_FILES_SCANNED)) {
    if (fileReferencesDetekt(file)) return file;
  }
  return null;
}

/**
 * A standalone `detekt` executable on PATH, or null. In-process PATH walk: no `which` spawn.
 * @returns {string|null}
 */
function findDetektOnPath() {
  const dirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const names = process.platform === 'win32' ? ['detekt.bat', 'detekt.cmd', 'detekt.exe'] : ['detekt'];
  for (const dir of dirs) {
    for (const name of names) {
      const file = path.join(dir, name);
      try {
        const st = fs.statSync(file);
        if (!st.isFile()) continue;
        if (process.platform !== 'win32') fs.accessSync(file, fs.constants.X_OK);
        return file;
      } catch { /* not here */ }
    }
  }
  return null;
}

/**
 * Detect detekt for an Android component root.
 *
 * `runner` tells buildCommand which invocation to build: 'gradle' (`./gradlew detekt …`, the
 * project's own config) wins over 'cli' (the standalone binary) when both exist.
 *
 * @param {string} root
 * @returns {{ name: 'detekt', available: true, version: string, path: string, runner: 'gradle'|'cli', configuredIn?: string }
 *         | { available: false, reason: string }}
 */
function detectDetekt(root) {
  try {
    const gradlew = path.join(root, 'gradlew');
    const hasGradlew = fs.existsSync(gradlew);
    if (hasGradlew) {
      const configuredIn = findDetektPlugin(root);
      if (configuredIn) {
        return {
          name: 'detekt', available: true, version: 'via gradlew', path: gradlew, runner: 'gradle',
          configuredIn: path.relative(root, configuredIn).split(path.sep).join('/')
        };
      }
    }
    const binary = findDetektOnPath();
    if (binary) return { name: 'detekt', available: true, version: 'cli', path: binary, runner: 'cli' };
    return {
      available: false,
      reason: hasGradlew
        ? 'gradlew found but no detekt plugin configured'
        : 'gradlew not found and detekt not on PATH — detekt unavailable'
    };
  } catch {
    return { available: false, reason: 'detekt detection failed' };
  }
}

module.exports = { detectDetekt, findDetektPlugin, findDetektOnPath, stripComments };
