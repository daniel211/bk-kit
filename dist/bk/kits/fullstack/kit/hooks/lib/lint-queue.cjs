/**
 * lint-queue.cjs — Session-scoped, append-only queue of edited files awaiting lint.
 *
 * Why: linting inside PostToolUse cost 0.57–1.61s of blocking wall time on every
 * Write/Edit in a real Flutter project. The lint now happens once per turn at Stop.
 * post-edit-lint.cjs only records a path here; stop-lint-flush.cjs drains and lints.
 *
 * Queue file: <project_root>/.bk-metrics/lint-queue/<session_id>.jsonl
 *   - one JSON object per line: { ts, file }
 *   - append-only (never read-modify-write), so concurrent PostToolUse hooks
 *     from the same turn cannot clobber each other. A single appendFileSync of a
 *     short line is atomic on POSIX for a file opened with O_APPEND.
 *   - keyed by session id, so two Claude sessions in one repo never see each
 *     other's files.
 *
 * Draining uses rename-then-read (takeQueue): the file is renamed out of the way
 * first, so an edit that lands mid-flush starts a fresh queue instead of being
 * silently truncated away.
 *
 * Every function fails open — errors are swallowed (or reported via a boolean),
 * never thrown, because no lint bookkeeping may block a tool call.
 *
 * Exports:
 *   LINTABLE_EXTENSIONS      — map of platform → extensions the linter can read
 *   isLintable(platform, f, root?) — should this file be queued at all? (root: composite kits)
 *   sanitizeSessionId(id)    — filesystem-safe session key
 *   resolveQueueFile(root, sessionId, namespace?)
 *   enqueueFile(queueFile, absFile, extra?)
 *   readQueuedFiles(queueFile)   — deduped, order-preserving (does not clear)
 *   takeQueue(queueFile)         — deduped path list + clears the queue atomically
 *   takeQueueEntries(queueFile)  — same claim, but whole entry objects
 *   clearQueue(queueFile)
 *   reapStaleQueues(root, opts)  — delete queues orphaned by sessions that never hit Stop
 *
 * The optional `namespace` gives a second, independent queue for the same session.
 * It matters because takeQueue claims by rename: two drainers pointed at one file
 * means whichever loses the race silently drops that whole batch. The deferred
 * native lint (lib/native-lint-deferred.cjs) is drained by its own Stop hook, so it
 * gets its own file — `<session>--native.jsonl` — not a share of this one.
 */

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Extensions each platform's linter can actually parse.
 *
 * python — ruff reads .py and .pyi stubs natively.
 *
 * web — every JS/TS module flavour eslint resolves: .ts/.tsx/.js/.jsx plus the ESM/CJS
 * variants .mjs/.cjs/.mts/.cts. Declaration files (*.d.ts) stay IN on purpose: a .d.ts the
 * agent writes is hand-authored code (module augmentation, global types), and
 * typescript-eslint lints it like any other .ts file. Generated ones (next-env.d.ts) are not
 * something an agent edits, and if a project's eslint config ignores them, eslint answers an
 * explicitly passed ignored file with a warning and exit 0 — no false failure either way.
 * Style files (.css/.scss) are deliberately absent: eslint cannot parse them.
 */
const LINTABLE_EXTENSIONS = {
  ios:     ['.swift'],
  android: ['.kt', '.kts', '.java'],
  flutter: ['.dart'],
  python:  ['.py', '.pyi'],
  web:     ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']
};

/**
 * Is this a file the platform linter can read?
 * Keeps .md/.json/.yaml edits out of the batch — they only produce noise.
 *
 * A composite platform (`fullstack`) has no linter of its own: the file is lintable when it
 * belongs to one of the project's components (lib/component-resolver.cjs — root prefix AND an
 * extension that component's platform lints), which needs `projectRoot`.
 * @param {string} platform
 * @param {string} filePath
 * @param {string} [projectRoot] — required for a composite platform; ignored otherwise
 * @returns {boolean}
 */
function isLintable(platform, filePath, projectRoot) {
  if (!filePath || typeof filePath !== 'string') return false;
  const resolver = require('./component-resolver.cjs');
  if (resolver.isComposite(platform)) {
    return Boolean(projectRoot) && resolver.componentForFile(filePath, projectRoot) !== null;
  }
  const exts = LINTABLE_EXTENSIONS[platform];
  if (!exts) return false;
  return exts.includes(path.extname(filePath).toLowerCase());
}

/**
 * Reduce a session id to a filesystem-safe key. Guards against a session id
 * carrying path separators or traversal segments into the queue path.
 * @param {string} sessionId
 * @returns {string}
 */
function sanitizeSessionId(sessionId) {
  const raw = (sessionId === undefined || sessionId === null) ? '' : String(sessionId);
  const safe = raw.replace(/[^A-Za-z0-9_-]/g, '-').replace(/^-+/, '').slice(0, 96);
  return safe || 'no-session';
}

/**
 * Absolute path of the queue file for one session.
 * @param {string} projectRoot
 * @param {string} sessionId
 * @param {string} [namespace] — separate queue file for a separate drainer
 * @returns {string}
 */
function resolveQueueFile(projectRoot, sessionId, namespace) {
  const suffix = namespace ? `--${String(namespace).replace(/[^A-Za-z0-9_-]/g, '-')}` : '';
  return path.join(projectRoot, '.bk-metrics', 'lint-queue', `${sanitizeSessionId(sessionId)}${suffix}.jsonl`);
}

/** Create the parent directory of a file path. Fails open. */
function ensureDir(filePath) {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Append one edited file to the queue. Append-only: safe under concurrent writers.
 * @param {string} queueFile
 * @param {string} absFile
 * @param {object} [extra] — extra fields on the entry (e.g. { platform: 'flutter' })
 * @returns {boolean} true when the line was written
 */
function enqueueFile(queueFile, absFile, extra) {
  if (!queueFile || !absFile) return false;
  try {
    ensureDir(queueFile);
    const entry = { ts: Date.now(), file: absFile, ...(extra && typeof extra === 'object' ? extra : {}) };
    fs.appendFileSync(queueFile, JSON.stringify(entry) + '\n', 'utf8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse a queue file's contents into deduped, order-preserving entry objects.
 * Dedupe is by `file`: a file edited eight times in a turn appears once, as its
 * first entry. Malformed lines are skipped rather than failing the flush.
 * @param {string} raw
 * @returns {object[]}
 */
function parseQueueEntries(raw) {
  const seen = new Set();
  const entries = [];
  for (const line of String(raw || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const file = entry && typeof entry.file === 'string' ? entry.file : '';
    if (!file || seen.has(file)) continue;
    seen.add(file);
    entries.push(entry);
  }
  return entries;
}

/**
 * Same as parseQueueEntries, reduced to the paths.
 * @param {string} raw
 * @returns {string[]}
 */
function parseQueueContent(raw) {
  return parseQueueEntries(raw).map((e) => e.file);
}

/**
 * Read the queue without clearing it. Deduped: a file edited eight times in a
 * turn appears once.
 * @param {string} queueFile
 * @returns {string[]}
 */
function readQueuedFiles(queueFile) {
  if (!queueFile) return [];
  try {
    if (!fs.existsSync(queueFile)) return [];
    return parseQueueContent(fs.readFileSync(queueFile, 'utf8'));
  } catch {
    return [];
  }
}

/**
 * Atomically claim the queue: rename it aside, read it, delete the copy.
 * Anything appended after the rename lands in a brand-new queue file and is
 * picked up by the next flush instead of being lost.
 * @param {string} queueFile
 * @returns {string} raw file contents ('' when there was nothing to claim)
 */
function claimQueue(queueFile) {
  if (!queueFile) return '';
  const claim = `${queueFile}.flushing-${process.pid}`;
  try {
    if (!fs.existsSync(queueFile)) return '';
    fs.renameSync(queueFile, claim);
  } catch {
    // Another flusher won the race, or the file vanished — nothing to do.
    return '';
  }
  let raw = '';
  try {
    raw = fs.readFileSync(claim, 'utf8');
  } catch {
    raw = '';
  }
  try {
    fs.unlinkSync(claim);
  } catch { /* fail-open */ }
  return raw;
}

/**
 * Atomically claim the queue and return its deduped file paths.
 * @param {string} queueFile
 * @returns {string[]} deduped file paths
 */
function takeQueue(queueFile) {
  return parseQueueContent(claimQueue(queueFile));
}

/**
 * Atomically claim the queue and return its deduped entry objects, so a caller
 * that wrote extra fields (platform, say) gets them back without re-deriving them.
 * @param {string} queueFile
 * @returns {object[]} deduped entries
 */
function takeQueueEntries(queueFile) {
  return parseQueueEntries(claimQueue(queueFile));
}

/**
 * How long a queue file must sit untouched before it is considered abandoned.
 *
 * 24 hours, deliberately generous. The queue directory is shared by every session in the
 * repo, and a second Claude session can be running concurrently with a live queue of its
 * own: deleting that file silently drops that turn's whole lint batch, with no error and
 * nothing to notice it by. A file whose mtime has not moved in 24 hours cannot belong to a
 * live turn, so the reap is unambiguous there; anything shorter is a guess about someone
 * else's session and is not safe.
 *
 * Contrast the 45-minute TTL in subagent-live-reaper.cjs: reaping a still-live subagent
 * there only suppresses a statusline entry and is backed by a synthetic stop row, so an
 * aggressive TTL costs nothing. Here it costs a lint pass the user asked for.
 */
const LINT_QUEUE_STALE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Delete queue files left behind by sessions that died before their Stop hook ran.
 *
 * takeQueue only ever runs at Stop. A session that is interrupted, killed, or crashes never
 * drains its queue, and nothing else ever looks at the file again — the field case was
 * fusionworkomni still holding a 2026-09-14 session's `<uuid>.jsonl` two days later. Called
 * at SessionStart, where "left over from a previous session" is unambiguous.
 *
 * The current session's own files are never touched, whatever their mtime: a resumed session
 * can legitimately own a queue older than the TTL, and its `--native` sibling (drained by a
 * separate Stop hook) must survive with it.
 *
 * @param {string} projectRoot — directory holding .bk-metrics/
 * @param {{ ttlMs?: number, now?: number, currentSessionId?: string }} [options]
 * @returns {number} how many queue files were removed (0 on any failure)
 */
function reapStaleQueues(projectRoot, options = {}) {
  try {
    if (!projectRoot || typeof projectRoot !== 'string') return 0;
    const ttlMs = typeof options.ttlMs === 'number' ? options.ttlMs : LINT_QUEUE_STALE_TTL_MS;
    const nowMs = typeof options.now === 'number' ? options.now : Date.now();

    const queueDir = path.join(projectRoot, '.bk-metrics', 'lint-queue');
    let entries;
    try {
      entries = fs.readdirSync(queueDir, { withFileTypes: true });
    } catch {
      return 0; // no queue directory yet — nothing to reap
    }

    // Sanitized, because that is how the filenames were built: comparing the raw session id
    // would miss a queue whose id contained characters resolveQueueFile had to replace.
    const own = options.currentSessionId ? sanitizeSessionId(options.currentSessionId) : null;

    let removed = 0;
    for (const entry of entries) {
      try {
        if (!entry.isFile()) continue;              // subdirectories are not ours
        const name = entry.name;
        if (!name.endsWith('.jsonl')) continue;     // leaves .flushing-<pid> claims alone

        // Protect both this session's queues: `<id>.jsonl` and `<id>--native.jsonl`.
        if (own) {
          const base = name.slice(0, -'.jsonl'.length);
          if (base === own || base.startsWith(`${own}--`)) continue;
        }

        const full = path.join(queueDir, name);
        const mtimeMs = fs.statSync(full).mtimeMs;
        if (nowMs - mtimeMs < ttlMs) continue;      // may still belong to a live session

        fs.unlinkSync(full);
        removed += 1;
      } catch { /* one bad entry must not stop the sweep */ }
    }
    return removed;
  } catch {
    return 0; // fail-open — reaping is housekeeping, never a precondition
  }
}

/**
 * Remove a session's queue file.
 * @param {string} queueFile
 * @returns {boolean}
 */
function clearQueue(queueFile) {
  if (!queueFile) return false;
  try {
    if (fs.existsSync(queueFile)) fs.unlinkSync(queueFile);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  LINTABLE_EXTENSIONS,
  isLintable,
  sanitizeSessionId,
  resolveQueueFile,
  enqueueFile,
  readQueuedFiles,
  takeQueue,
  takeQueueEntries,
  clearQueue,
  reapStaleQueues,
  LINT_QUEUE_STALE_TTL_MS
};
