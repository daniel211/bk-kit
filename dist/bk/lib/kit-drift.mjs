/**
 * kit-drift.mjs — Which installed kit files no longer match what was installed.
 *
 * `.bk-version.json` records a sha256 per file that `init`/`update` wrote into `.claude/`.
 * Doctor used to only ask whether each path still existed, so a kit file whose CONTENT had
 * been edited locally reported green: a patched agent lived unnoticed in a downstream project
 * for a whole release cycle because "416/416 present" said nothing about what was inside them.
 *
 * Drift is not a fault. `bk update` already detects it, reports a conflict and refuses to
 * clobber the local copy, so the dangerous path is safe; what was missing is visibility. This
 * module answers "what has diverged" and leaves the verdict wording to the caller.
 *
 * Hashing is delegated to hash-tracker.hashFile — the same helper `update` compares with, so
 * doctor and update can never disagree about what a file's hash is.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashFile } from './hash-tracker.mjs';

/** How many drifted paths are listed before collapsing the rest into "... and N more". */
export const DRIFT_DISPLAY_CAP = 5;

/**
 * Files the kit ships once and then expects the USER to own, so a changed hash means the file
 * is doing its job rather than that kit content drifted.
 *
 * Two files qualify, on evidence:
 *  - `.bk.json` is the kit's project config layer — hooks/lib/bk-config-utils.cjs reads
 *    `<root>/.claude/.bk.json` over the defaults for locale, per-hook enable/disable and
 *    tunables — and `doctorIgnore` below lives in it too. Reporting it would make the ignore
 *    mechanism self-defeating: silencing one file would immediately raise a warning about the
 *    file you silenced it in.
 *  - `platform-context.json` holds per-project values a shipped template cannot know, so the
 *    build writes a starting point and the project is expected to replace it. It drifted in 2
 *    of 2 field repos: trustcall_ios carries
 *    `xcodebuild -project TrustCall.xcodeproj -scheme 'TrustCall DEV' …`, fusionworkomni its own
 *    Flutter build/test/lint commands. The kit's own docs say to do this —
 *    docs/antigravity-cli-guide.md:232 ("platform-context.json gần như chắc chắn conflict. File
 *    này thường đã được customise cho project") and :148, which tells teams to set
 *    `designEngine` in it per project. A check that warns on essentially every real install is
 *    a check users learn to ignore, which costs the warnings that matter. (An earlier comment
 *    here argued the opposite — that a changed hash is a hand edit and therefore exactly what
 *    this check is for. It is a hand edit; it is the one the kit asks for.)
 *  - `settings.local.json` is not in the manifest at all: init never installs it, so there is
 *    nothing to exclude. (`settings.json` IS installed, but init merges the user's existing
 *    file and then hashes what it wrote, so the recorded hash already includes their settings;
 *    a later change to it is a real post-install edit and stays reported.)
 *  - No hook writes into `.claude/` at all: runtime state goes to project-root dotfiles
 *    (.bk-preferences.json, .bk-project-profile.json), os.tmpdir(), or bk/dev/shared.
 *
 * Presence is still checked for these — a missing `.bk.json` is worth knowing about, and
 * cmd-doctor's separate `platform-context.json valid` check still parses that file. What stops
 * is calling a customised copy "modified locally".
 */
export const USER_OWNED_FILES = new Set(['.bk.json', 'platform-context.json']);

/**
 * Normalize a path to the key format used by `.bk-version.json`'s `files` map.
 *
 * Users write `doctorIgnore` entries by hand, so `./agents/x.md`, `agents\x.md` and
 * `agents/x.md` all have to mean the same file.
 *
 * @param {string} p
 * @returns {string}
 */
function normalizeKey(p) {
  return String(p).replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

/**
 * Load one `.bk.json`, returning null on miss or on anything unparseable.
 *
 * Mirrors hooks/lib/bk-config-utils.cjs `loadConfigFromPath`. The user CLI deliberately does
 * not import that module — it is a CommonJS file that ships inside the installed kit, while
 * this CLI runs from the package — so the read is duplicated rather than depended on.
 *
 * @param {string} configPath
 * @returns {object|null}
 */
function loadConfigFromPath(configPath) {
  try {
    if (!existsSync(configPath)) return null;
    const data = JSON.parse(readFileSync(configPath, 'utf8'));
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

/**
 * Paths the user has declared they customised on purpose, and does not want reported.
 *
 * Read from the project's own `.claude/.bk.json`, the same file every other kit setting comes
 * from. Deliberately project-only: the global `~/.claude/.bk.json` the hooks also merge would
 * make one machine's doctor disagree with another's about the same repo, which is the opposite
 * of what this check is for.
 *
 * @param {string} targetDir — project root containing .claude/
 * @returns {string[]} normalized paths relative to .claude/
 */
export function readDoctorIgnore(targetDir) {
  const cfg = loadConfigFromPath(join(targetDir, '.claude', '.bk.json'));
  const list = Array.isArray(cfg?.doctorIgnore) ? cfg.doctorIgnore : [];
  return list.filter((entry) => typeof entry === 'string' && entry.trim() !== '').map(normalizeKey);
}

/**
 * Compare every recorded kit file against what is on disk.
 *
 * Files are hashed one at a time and never retained, so the ~416 files of a full kit cost one
 * read each and never more than one file's worth of memory. Nothing here throws: a file that
 * cannot be read (permissions, a directory in its place, a file too large for a single read)
 * is reported as unreadable, because a doctor that crashes tells the user less than a doctor
 * that says which file it could not open.
 *
 * @param {string} claudeDir — the project's .claude/ directory
 * @param {Record<string,string>} files — the `files` map from .bk-version.json
 * @param {object} [opts]
 * @param {string[]} [opts.ignore] — paths to skip silently (see readDoctorIgnore)
 * @returns {{total: number, checked: number, ignored: number, userOwned: number, missing: string[],
 *            drifted: string[], unreadable: string[]}}
 */
export function detectDrift(claudeDir, files, { ignore = [] } = {}) {
  const ignored = new Set(ignore.map(normalizeKey));
  const result = {
    total: 0,
    checked: 0,
    ignored: 0,
    userOwned: 0,
    missing: [],
    drifted: [],
    unreadable: [],
  };

  for (const [rawPath, recordedHash] of Object.entries(files || {})) {
    const relPath = normalizeKey(rawPath);
    result.total++;

    if (ignored.has(relPath)) {
      result.ignored++;
      continue;
    }

    const fullPath = join(claudeDir, rawPath);
    if (!existsSync(fullPath)) {
      result.missing.push(relPath);
      continue;
    }

    // Present but user-owned: presence was the question worth asking, content is not.
    if (USER_OWNED_FILES.has(relPath)) {
      result.userOwned++;
      continue;
    }

    // A record with no hash (older installs) can still be checked for existence, which is what
    // doctor did before this module existed. Nothing to compare, so nothing to report.
    if (typeof recordedHash !== 'string' || recordedHash === '') {
      result.checked++;
      continue;
    }

    let actual;
    try {
      actual = hashFile(fullPath);
    } catch (err) {
      result.unreadable.push(`${relPath} (${err.message})`);
      continue;
    }

    result.checked++;
    if (actual !== recordedHash) result.drifted.push(relPath);
  }

  result.missing.sort();
  result.drifted.sort();
  result.unreadable.sort();
  return result;
}

/**
 * Render a path list capped at `cap`, with the overflow collapsed into one line.
 *
 * A project that has customised thirty files should learn that fact in six lines, not thirty.
 *
 * @param {string[]} paths
 * @param {number} [cap]
 * @returns {string[]} lines, already prefixed with "- "
 */
export function formatDriftList(paths, cap = DRIFT_DISPLAY_CAP) {
  const lines = paths.slice(0, cap).map((p) => `- ${p}`);
  const rest = paths.length - Math.min(paths.length, cap);
  if (rest > 0) lines.push(`... and ${rest} more`);
  return lines;
}
