/**
 * kit-resolver.mjs — Which platform kit a command runs with.
 *
 * The kit used to be baked into the binary: `bk-ios init` could only ever mean iOS, because the
 * build shipped three packages that differed in one substituted string. One package with one `bk`
 * binary cannot do that, so the platform is now decided per command — and every command that
 * needs a kit has to decide it the same way, or `init` and `update` end up disagreeing about
 * which kit a project has.
 *
 * The order below is that single answer: what the user typed wins, then what the project already
 * recorded at install time, then what the project looks like. Nothing guesses beyond that — a
 * wrong guess writes a whole kit of the wrong platform into .claude/.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The kits this CLI knows how to ship, in the order they are listed to the user. */
export const KIT_NAMES = ['ios', 'android', 'flutter', 'python', 'web', 'fullstack'];

/**
 * Which kit wins when a project carries several markers at once.
 *
 * A Flutter repo normally contains an `ios/` and an `android/` host project, and an iOS repo with
 * a Swift package has both `Package.swift` and an `.xcodeproj`. Only the target dir's own root is
 * inspected (never nested dirs), so this only fires for genuinely mixed roots — and flutter first
 * matches the one case that actually occurs: the Flutter root is the outer project.
 *
 * The mobile kits come before python and web: a mobile repo often carries a requirements.txt (for
 * fastlane or tooling scripts) or a package.json, while a backend or web root rarely carries a
 * pubspec.yaml or an .xcodeproj. fullstack sits between them: python AND web markers, at the
 * root or in a first-level subdir (see detectFullstack), mean one repo with both stacks.
 */
const PREFERENCE = ['flutter', 'ios', 'android', 'fullstack', 'python', 'web'];

/**
 * The single-platform kits a composite kit is made of (src/bk-manifest.json `components`).
 * Only what the resolver needs: which marker sets must both be present.
 */
export const COMPOSITE_KITS = { fullstack: ['python', 'web'] };

/**
 * First-level dirs never scanned for component markers: dependencies, venvs, and dirs that hold
 * tooling rather than a component (a `docs/requirements.txt` for mkdocs must not turn a web repo
 * into fullstack). Dot-dirs are skipped separately. MUST equal SKIPPED_SUBDIRS in
 * hooks/_base/lib/project-detector.cjs (the hooks' copy) — a test asserts the two lists match.
 */
export const SKIPPED_SUBDIRS = new Set([
  'node_modules', '.venv', 'venv',
  'docs', 'doc', 'scripts', 'tools', 'examples', 'e2e', 'tests', 'test'
]);

/**
 * Conventional component dir names, most likely first. Picks among several first-level subdirs
 * carrying the same platform's markers — for a fullstack component root (component-detector) and
 * for a single-stack kit whose markers sit only in a subdir (detectKitsFromMarkers). Only these
 * platforms are looked for in subdirs; mobile kits are detected at the root only.
 */
export const CONVENTIONAL_DIRS = {
  python: ['backend', 'api', 'server'],
  web: ['frontend', 'web', 'client', 'app'],
};

/**
 * The dir to use among a platform's marker hits (platformMarkerDirs order): a conventional
 * subdir name first, else the root, else the first subdir alphabetically. The one rule both
 * kit detection and `bk init`'s root detection apply.
 *
 * @param {string} platform
 * @param {Array<{dir: string, marker: string}>} hits
 * @returns {{dir: string, marker: string}|null}
 */
export function pickMarkerDir(platform, hits) {
  if (!hits || hits.length === 0) return null;
  const conventional = (CONVENTIONAL_DIRS[platform] || [])
    .map((name) => hits.find((h) => h.dir === name))
    .find(Boolean);
  return conventional || hits.find((h) => h.dir === '.') || hits[0];
}

/** Config files that make a package.json root a TypeScript / bundled web project. */
function isWebConfigFile(name) {
  return name === 'tsconfig.json' || /^(next|vite)\.config\.[cm]?[jt]s$/.test(name);
}

/**
 * Root-level files that identify a project's platform.
 *
 * `label` is what the failure message tells the user was searched for, so it has to read like the
 * filenames a developer would look for, not like the predicate.
 *
 * `matches(name, entries)` is called per root entry; `entries` is the whole root listing, for a
 * marker that needs a companion file. web is the one that does: package.json alone also sits at
 * the root of plain Node tools and of most mobile repos' tooling, so it only counts next to a
 * tsconfig.json, next.config.* or vite.config.* — the files that make the root a TS/React app.
 */
const MARKERS = [
  {
    platform: 'flutter',
    label: 'pubspec.yaml',
    matches: (name) => name === 'pubspec.yaml',
  },
  {
    platform: 'ios',
    label: '*.xcodeproj, *.xcworkspace, Package.swift',
    matches: (name) => name.endsWith('.xcodeproj') || name.endsWith('.xcworkspace') || name === 'Package.swift',
  },
  {
    platform: 'android',
    label: 'build.gradle, build.gradle.kts, settings.gradle*',
    matches: (name) => name === 'build.gradle' || name === 'build.gradle.kts' || name.startsWith('settings.gradle'),
  },
  {
    platform: 'python',
    label: 'pyproject.toml, requirements.txt, manage.py, setup.py',
    matches: (name) => ['pyproject.toml', 'requirements.txt', 'manage.py', 'setup.py'].includes(name),
  },
  {
    platform: 'web',
    label: 'package.json with tsconfig.json, next.config.* or vite.config.*',
    matches: (name, entries) => name === 'package.json' && entries.some(isWebConfigFile),
  },
];

/** Markers sorted so the ambiguity winner comes first. */
function markersByPreference() {
  return [...MARKERS].sort((a, b) => PREFERENCE.indexOf(a.platform) - PREFERENCE.indexOf(b.platform));
}

/** The root marker file of `platform` in a directory listing, or null. */
function markerIn(platform, entries) {
  const marker = MARKERS.find((m) => m.platform === platform);
  return (marker && entries.find((name) => marker.matches(name, entries))) || null;
}

/** Directory listing, [] when unreadable. */
function listDir(dir, withFileTypes = false) {
  try { return readdirSync(dir, { withFileTypes }); } catch { return []; }
}

/**
 * Where a platform's markers sit: the root ('.') and/or first-level subdirs.
 *
 * One readdir of the root plus one per subdir — no deeper walk. SKIPPED_SUBDIRS and dot-dirs
 * are skipped. Shared by fullstack detection and `bk init`'s component roots, so both
 * see the same marker sets as single-platform detection.
 *
 * @param {string} targetDir - project root
 * @param {string} platform - 'python' | 'web' | any MARKERS platform
 * @returns {Array<{dir: string, marker: string}>} root first, then subdirs alphabetically
 */
export function platformMarkerDirs(targetDir, platform) {
  const found = [];
  const rootHit = markerIn(platform, listDir(targetDir));
  if (rootHit) found.push({ dir: '.', marker: rootHit });
  const subdirs = listDir(targetDir, true)
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SKIPPED_SUBDIRS.has(e.name))
    .map((e) => e.name)
    .sort();
  for (const name of subdirs) {
    const hit = markerIn(platform, listDir(join(targetDir, name)));
    if (hit) found.push({ dir: name, marker: hit });
  }
  return found;
}

/**
 * A composite kit whose component platforms all have markers (root or first-level subdir).
 * The marker text names the first hit of each, e.g. `backend/manage.py + frontend/package.json`.
 *
 * @param {string} targetDir
 * @returns {Array<{platform: string, marker: string}>}
 */
function detectComposites(targetDir) {
  const found = [];
  for (const [kit, parts] of Object.entries(COMPOSITE_KITS)) {
    const hits = parts.map((p) => platformMarkerDirs(targetDir, p)[0]);
    if (hits.every(Boolean)) {
      found.push({ platform: kit, marker: hits.map((h) => (h.dir === '.' ? h.marker : `${h.dir}/${h.marker}`)).join(' + ') });
    }
  }
  return found;
}

/**
 * The kits actually present in the installed package.
 *
 * Read from disk rather than from KIT_NAMES so a `--kit` typo fails against what this package can
 * really do, instead of crashing later on a path that was never built.
 *
 * @param {string} packageRoot — directory holding kits/
 * @returns {string[]} kit names, in KIT_NAMES order
 */
export function installedKits(packageRoot) {
  const kitsDir = join(packageRoot, 'kits');
  if (!existsSync(kitsDir)) return [];
  const present = new Set(
    readdirSync(kitsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name),
  );
  return KIT_NAMES.filter((name) => present.has(name));
}

/**
 * The platform a previous `init` recorded in the project's .bk-version.json.
 *
 * @param {string} targetDir — project root
 * @returns {string|null} platform name, or null when absent or unreadable
 */
export function recordedKit(targetDir) {
  const versionPath = join(targetDir, '.bk-version.json');
  if (!existsSync(versionPath)) return null;
  try {
    const data = JSON.parse(readFileSync(versionPath, 'utf8'));
    return KIT_NAMES.includes(data.platform) ? data.platform : null;
  } catch {
    // A corrupt .bk-version.json is the caller's problem to report, not a reason to fail
    // resolution outright — the marker scan below may still know the answer.
    return null;
  }
}

/**
 * Platforms whose marker files sit in the target dir's own root, plus composite kits
 * (fullstack) whose component markers sit at the root or in first-level subdirs; when neither
 * matched, python / web markers in a first-level subdir (detectSubdirSingles).
 *
 * A detected composite replaces its parts in the list: python and web are what fullstack is
 * made of, not alternatives to it, and listing them would turn every fullstack init into an
 * ambiguity note.
 *
 * @param {string} targetDir — project root
 * @param {string[]} [known] — kits the package ships; a composite it does not ship is neither
 *   reported nor allowed to hide its parts
 * @returns {Array<{platform: string, marker: string}>} matches, best candidate first
 */
export function detectKitsFromMarkers(targetDir, known = KIT_NAMES) {
  let entries;
  try {
    entries = readdirSync(targetDir);
  } catch {
    return [];
  }

  let found = [];
  for (const marker of markersByPreference()) {
    const hit = entries.find((name) => marker.matches(name, entries));
    if (hit) found.push({ platform: marker.platform, marker: hit });
  }
  const composites = detectComposites(targetDir).filter((c) => known.includes(c.platform));
  if (composites.length > 0) {
    const parts = new Set(composites.flatMap((c) => COMPOSITE_KITS[c.platform]));
    found = found.filter((f) => !parts.has(f.platform)).concat(composites);
    found.sort((a, b) => PREFERENCE.indexOf(a.platform) - PREFERENCE.indexOf(b.platform));
  }
  if (found.length === 0) found = detectSubdirSingles(targetDir);
  return found;
}

/**
 * Single-stack kits whose markers sit only in first-level subdirs (AHub: `backend/pyproject.toml`,
 * nothing at the root). Consulted only when the root itself matched nothing — root markers always
 * win — and after the composite check, so python + web in two subdirs stays fullstack. The marker
 * names the dir pickMarkerDir chooses, e.g. `backend/pyproject.toml`.
 *
 * @param {string} targetDir
 * @returns {Array<{platform: string, marker: string}>} in PREFERENCE order
 */
function detectSubdirSingles(targetDir) {
  const found = [];
  for (const platform of Object.keys(CONVENTIONAL_DIRS)) {
    const pick = pickMarkerDir(platform, platformMarkerDirs(targetDir, platform).filter((h) => h.dir !== '.'));
    if (pick) found.push({ platform, marker: `${pick.dir}/${pick.marker}` });
  }
  return found.sort((a, b) => PREFERENCE.indexOf(a.platform) - PREFERENCE.indexOf(b.platform));
}

/** The marker list as the failure message prints it. */
function searchedMarkersText() {
  const lines = markersByPreference().map((m) => `    ${m.platform.padEnd(9)} ${m.label}`);
  for (const [kit, parts] of Object.entries(COMPOSITE_KITS)) {
    lines.push(`    ${kit.padEnd(9)} ${parts.join(' and ')} markers, at the root or in first-level subdirs`);
  }
  lines.push(`    ${Object.keys(CONVENTIONAL_DIRS).join(' / ')} markers in one first-level subdir when the root has none`
    + ` (backend/, frontend/, …; not ${['docs', 'scripts', 'tests'].join('/')}/ or dot-dirs)`);
  return lines.join('\n');
}

/**
 * Decide which kit a command should use.
 *
 * @param {object} opts
 * @param {string} opts.packageRoot — directory holding kits/
 * @param {string} opts.targetDir — project root being acted on
 * @param {string} [opts.explicit] — value of --kit, when given
 * @param {boolean} [opts.useRecorded] — consult .bk-version.json (update/doctor/docs, not init)
 * @returns {{ok: true, platform: string, source: 'flag'|'version-file'|'marker', note?: string}
 *          | {ok: false, message: string}}
 */
export function resolveKit({ packageRoot, targetDir, explicit, useRecorded = true }) {
  const available = installedKits(packageRoot);
  const known = available.length > 0 ? available : KIT_NAMES;

  if (explicit) {
    if (!known.includes(explicit)) {
      return {
        ok: false,
        message: `Unknown kit "${explicit}". This package ships: ${known.join(', ')}.`,
      };
    }
    return { ok: true, platform: explicit, source: 'flag' };
  }

  if (useRecorded) {
    const recorded = recordedKit(targetDir);
    if (recorded && known.includes(recorded)) {
      return { ok: true, platform: recorded, source: 'version-file' };
    }
  }

  const detected = detectKitsFromMarkers(targetDir, known).filter((d) => known.includes(d.platform));
  if (detected.length === 1) {
    return { ok: true, platform: detected[0].platform, source: 'marker' };
  }
  if (detected.length > 1) {
    const [winner, ...rest] = detected;
    const others = rest.map((d) => `${d.platform} (${d.marker})`).join(', ');
    return {
      ok: true,
      platform: winner.platform,
      source: 'marker',
      note: `Found markers for several kits — using ${winner.platform} (${winner.marker}); also saw ${others}.`
        + ` Pass --kit <${known.join('|')}> to choose a different one.`,
    };
  }

  return {
    ok: false,
    message: [
      `Could not tell which kit to use for ${targetDir}.`,
      `Pass --kit <${known.join('|')}>.`,
      '',
      '  Searched that directory for:',
      searchedMarkersText(),
      useRecorded ? '  and for a "platform" field in .bk-version.json.' : '',
    ].filter((line) => line !== '').join('\n'),
  };
}

/**
 * resolveKit, reporting to the terminal: prints an ambiguity note, or exits 1 with the failure.
 *
 * Commands share this so every one of them fails the same way — a different wording per command
 * is how a user learns to ignore the message.
 *
 * @param {Parameters<typeof resolveKit>[0]} opts
 * @returns {string} the resolved platform
 */
export function resolveKitOrExit(opts) {
  const result = resolveKit(opts);
  if (!result.ok) {
    console.error(`Error: ${result.message}`);
    process.exit(1);
  }
  if (result.note) console.log(`  ℹ ${result.note}\n`);
  return result.platform;
}

/**
 * Register the shared --kit option on a command.
 *
 * One definition so the flag, its wording and its valid values are identical on every command
 * that takes it.
 *
 * @param {import('commander').Command} command
 * @returns {import('commander').Command} the same command, for chaining
 */
export function addKitOption(command) {
  return command.option(
    '--kit <platform>',
    `Which kit to use: ${KIT_NAMES.join(' | ')} (auto-detected when omitted)`,
  );
}
