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
export const KIT_NAMES = ['ios', 'android', 'flutter', 'python', 'web'];

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
 * pubspec.yaml or an .xcodeproj. A fullstack root with both pyproject.toml and a TS package.json
 * resolves to python, with the ambiguity note telling the user how to pick web instead.
 */
const PREFERENCE = ['flutter', 'ios', 'android', 'python', 'web'];

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
 * Platforms whose marker files sit in the target dir's own root.
 *
 * @param {string} targetDir — project root
 * @returns {Array<{platform: string, marker: string}>} matches, best candidate first
 */
export function detectKitsFromMarkers(targetDir) {
  let entries;
  try {
    entries = readdirSync(targetDir);
  } catch {
    return [];
  }

  const found = [];
  for (const marker of markersByPreference()) {
    const hit = entries.find((name) => marker.matches(name, entries));
    if (hit) found.push({ platform: marker.platform, marker: hit });
  }
  return found;
}

/** The marker list as the failure message prints it. */
function searchedMarkersText() {
  return markersByPreference().map((m) => `    ${m.platform.padEnd(8)} ${m.label}`).join('\n');
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

  const detected = detectKitsFromMarkers(targetDir).filter((d) => known.includes(d.platform));
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
