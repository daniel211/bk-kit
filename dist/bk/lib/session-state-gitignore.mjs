/**
 * session-state-gitignore.mjs — Keep the kit's per-machine session state out of git.
 *
 * Shared by `init` and `update` (which write the ignore entries) and `doctor` (which checks
 * that they hold and that nothing is already tracked). One list, one matcher, so the three
 * commands cannot disagree about what "session state" means.
 *
 * Why this is enforced rather than suggested: until 0.10.1 `init` only wrote the entries under
 * `--gitignore` and otherwise printed a notice. The iOS field repo X-Game-Pro has no .gitignore
 * at all; its kit-install commit already carried .workflow-state.json, the statusline cache and
 * three .bk-metrics/ files, and on 2026-09-23 bk-git-manager, asked to "commit this task" plus
 * bk state, made 75e97db adding .workflow-state.json.bak, .retry-state.json and five
 * checkpoints on top. Nothing in the kit said a word — the notice had scrolled past once, at
 * install time.
 */

import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * Paths the kit writes that must never be committed.
 *
 * Every one is a record of *this machine's* session, not of the work:
 *
 *   .workflow-state.json  FSM phase plus session-scoped agent ids — `dev_agent_id` is
 *                         resumable only in the session that spawned it, so the file is
 *                         actively misleading on a second machine. It also changes on
 *                         nearly every tool call, and merging its counters and appended
 *                         arrays is exactly what git cannot do.
 *   checkpoints/          snapshots of the above
 *   handoff/              context-reset handoff notes, written per session
 *   .statusline-cache.json, .retry-state.json   live counters
 *   .bk-metrics/          per-developer runtime telemetry. Unanchored on purpose: the kit also
 *                         writes it under feature dirs (X-Game-Pro tracks
 *                         bk/dev/ios-project-init/.bk-metrics/), and gitignore matches a
 *                         slash-free pattern at any depth.
 *
 * What carries work between machines is the plan directory — `bk/dev/{feature}/` with its
 * `.plan-state.json` — which records what is *done* rather than which session did it, and
 * from which the phase is re-derived on the other machine. That is what belongs in git.
 *
 * Mirrored by SESSION_STATE in hooks/_base/post-commit.cjs (the hook is CommonJS and ships in a
 * different tree); post-commit.test.mjs drives the hook with every entry here, so the two
 * cannot drift silently.
 */
export const NEVER_COMMIT = [
  'bk/dev/shared/.workflow-state.json',
  'bk/dev/shared/.workflow-state.json.*',
  'bk/dev/shared/checkpoints/',
  'bk/dev/shared/handoff/',
  'bk/dev/shared/.statusline-cache.json',
  'bk/dev/shared/.retry-state.json',
  '.bk-metrics/',
];

export const GITIGNORE_HEADER =
  '# beer-kit — per-machine session state; the plans in bk/dev/{feature}/ are committed';

/** Run git in `cwd`; never throws. */
function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 10000 });
  return { status: r.error ? -1 : r.status, stdout: r.stdout || '' };
}

/**
 * Where `dir` sits inside its git work tree, or null when it is not in one (or git is absent).
 *
 * The prefix matters because `git ls-files -x` anchors a pattern at the repository top, while
 * the kit's entries are relative to the project — which is a subdirectory in a monorepo.
 *
 * @param {string} dir
 * @returns {string|null} '' at the top level, 'apps/ios/' in a subdirectory
 */
export function gitPrefix(dir) {
  const r = git(dir, ['rev-parse', '--is-inside-work-tree', '--show-prefix']);
  if (r.status !== 0) return null;
  const [inside, prefix = ''] = r.stdout.split('\n');
  return inside.trim() === 'true' ? prefix.trim() : null;
}

/**
 * Concrete paths that an entry must cover. A glob is probed with both siblings the kit writes
 * (.bak and .lock), because a user rule like `*.bak` covers one and not the other.
 */
function probesFor(entry) {
  if (entry.endsWith('/')) return [`${entry}probe`];
  if (entry.endsWith('*')) return ['bak', 'lock'].map((s) => entry.slice(0, -1) + s);
  return [entry];
}

/**
 * Read the project's .gitignore as a set of trimmed, de-slashed entries.
 * @param {string} targetDir
 */
function readGitignoreEntries(targetDir) {
  let text = '';
  try {
    text = readFileSync(join(targetDir, '.gitignore'), 'utf8');
  } catch {
    // No .gitignore — nothing is ignored yet.
  }
  const entries = new Set(
    text.split('\n').map((l) => l.trim().replace(/\/$/, '')).filter(Boolean),
  );
  return { text, entries };
}

/**
 * NEVER_COMMIT entries the project does not ignore yet.
 *
 * Inside a git repository git itself answers (`check-ignore --no-index`, so a file that is
 * tracked still reports the rule that covers it): a broader rule the user already has —
 * `bk/dev/shared/`, a global excludes file — counts, and `update` does not pile redundant
 * lines on top of it every release. Outside one, the .gitignore text is all there is.
 *
 * @param {string} targetDir
 * @returns {string[]}
 */
export function missingIgnoreEntries(targetDir) {
  if (gitPrefix(targetDir) !== null) {
    const probes = NEVER_COMMIT.flatMap(probesFor);
    const r = git(targetDir, ['check-ignore', '--no-index', '--', ...probes]);
    // 0 = some ignored, 1 = none ignored; anything else is git failing — fall through to text.
    if (r.status === 0 || r.status === 1) {
      const ignored = new Set(r.stdout.split('\n').map((l) => l.trim()).filter(Boolean));
      return NEVER_COMMIT.filter((e) => !probesFor(e).every((p) => ignored.has(p)));
    }
  }
  const { entries } = readGitignoreEntries(targetDir);
  return NEVER_COMMIT.filter((e) => !entries.has(e.replace(/\/$/, '')));
}

/**
 * Append the missing never-commit entries to .gitignore, creating it if needed.
 *
 * Appends only what is absent, so running it twice adds nothing the second time and a user
 * who ignores more than the kit asks for keeps their own rules.
 *
 * @param {string} targetDir
 * @returns {string[]} The entries actually written
 */
export function writeGitignoreEntries(targetDir) {
  const missing = missingIgnoreEntries(targetDir);
  if (missing.length === 0) return [];

  const { text } = readGitignoreEntries(targetDir);
  const prefix = text.length === 0 || text.endsWith('\n') ? '' : '\n';
  const lead = text.length === 0 ? '' : '\n';
  appendFileSync(
    join(targetDir, '.gitignore'),
    `${prefix}${lead}${GITIGNORE_HEADER}\n${missing.join('\n')}\n`,
    'utf8',
  );
  return missing;
}

/**
 * Session-state files git is tracking, or null outside a git repository.
 *
 * Each hit carries the pathspec to untrack it with: a directory entry collapses to the
 * directory (five checkpoints are one `bk/dev/shared/checkpoints`), found at whatever depth
 * the unanchored `.bk-metrics/` matched.
 *
 * @param {string} targetDir
 * @returns {{ files: string[], pathspecs: string[] } | null} paths relative to targetDir
 */
export function trackedSessionState(targetDir) {
  const prefix = gitPrefix(targetDir);
  if (prefix === null) return null;

  const files = new Set();
  const pathspecs = new Set();
  for (const entry of NEVER_COMMIT) {
    const bare = entry.replace(/\/$/, '');
    const anchored = bare.includes('/');
    const r = git(targetDir, ['ls-files', '-c', '-i', '-x', anchored ? prefix + entry : entry]);
    if (r.status !== 0) continue;
    for (const file of r.stdout.split('\n').map((l) => l.trim()).filter(Boolean)) {
      files.add(file);
      if (!entry.endsWith('/')) {
        pathspecs.add(file);
      } else if (anchored) {
        pathspecs.add(bare);
      } else {
        const at = `/${file}`.lastIndexOf(`/${bare}/`);
        pathspecs.add(at >= 0 ? file.slice(0, at + bare.length) : file);
      }
    }
  }
  return { files: [...files].sort(), pathspecs: [...pathspecs].sort() };
}

/** Quote a path for a POSIX shell only when it needs it. */
const sh = (p) => (/^[\w./@+-]+$/.test(p) ? p : `'${p.replace(/'/g, `'\\''`)}'`);

/** The command that stops tracking the given pathspecs while leaving the files on disk. */
export function untrackCommand(pathspecs) {
  return `git rm -r --cached --quiet -- ${pathspecs.map(sh).join(' ')}`;
}

/** A command that appends the given entries to .gitignore, with the kit's header. */
export function appendIgnoreCommand(entries) {
  return `printf '%s\\n' '' ${sh(GITIGNORE_HEADER)} ${entries.map(sh).join(' ')} >> .gitignore`;
}
