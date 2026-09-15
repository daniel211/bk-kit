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
 *   isLintable(platform, f)  — should this file be queued at all?
 *   sanitizeSessionId(id)    — filesystem-safe session key
 *   resolveQueueFile(root, sessionId, namespace?)
 *   enqueueFile(queueFile, absFile, extra?)
 *   readQueuedFiles(queueFile)   — deduped, order-preserving (does not clear)
 *   takeQueue(queueFile)         — deduped path list + clears the queue atomically
 *   takeQueueEntries(queueFile)  — same claim, but whole entry objects
 *   clearQueue(queueFile)
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

/** Extensions each platform's linter can actually parse. */
const LINTABLE_EXTENSIONS = {
  ios:     ['.swift'],
  android: ['.kt', '.kts', '.java'],
  flutter: ['.dart']
};

/**
 * Is this a file the platform linter can read?
 * Keeps .md/.json/.yaml edits out of the batch — they only produce noise.
 * @param {string} platform
 * @param {string} filePath
 * @returns {boolean}
 */
function isLintable(platform, filePath) {
  if (!filePath || typeof filePath !== 'string') return false;
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
  clearQueue
};
