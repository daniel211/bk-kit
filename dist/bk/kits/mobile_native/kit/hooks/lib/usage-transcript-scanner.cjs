/**
 * usage-transcript-scanner.cjs — incremental reader for Claude Code transcripts
 *
 * Claude Code appends one JSONL file per session under
 * `~/.claude/projects/<slug>/<session-id>.jsonl` (subagent turns land in a
 * `<session-id>/` sub-directory). The files only ever grow, so a rollup can
 * remember a byte offset per file and read the delta instead of the whole
 * history — the difference between a multi-second scan and a few milliseconds.
 *
 * Exports:
 *   listTranscripts(projectsDir) → string[] absolute paths
 *   scanFile(filePath, fromOffset, onEntry) → { offset, lines, parsed }
 *
 * Everything here is fail-open: an unreadable file or a corrupt line is skipped,
 * never thrown, because this feeds a statusline that must not break a session.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Read the delta in bounded slices so a huge first scan never allocates the
// whole file at once.
const CHUNK_BYTES = 4 * 1024 * 1024;

/**
 * All transcript files under a projects directory, recursively.
 *
 * @param {string} projectsDir — usually `~/.claude/projects`
 * @param {number} [maxDepth] — guard against pathological trees
 * @returns {string[]} absolute paths to `*.jsonl` files
 */
function listTranscripts(projectsDir, maxDepth = 4) {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) out.push(full);
    }
  };
  walk(projectsDir, 0);
  return out;
}

/**
 * Read a transcript from `fromOffset` to EOF, handing every parsed JSON line to
 * `onEntry`. A trailing partial line (the session is still writing) is left
 * unconsumed: the returned offset points at its first byte, so the next scan
 * picks it up whole.
 *
 * @param {string} filePath
 * @param {number} fromOffset — byte offset to resume from; 0 for a full read
 * @param {(entry: object) => void} onEntry
 * @returns {{ offset: number, lines: number, parsed: number }}
 */
function scanFile(filePath, fromOffset, onEntry) {
  const result = { offset: fromOffset || 0, lines: 0, parsed: 0 };
  let fd = null;
  try {
    const stat = fs.statSync(filePath);
    // A file that shrank was truncated or rotated — the offset is meaningless,
    // so re-read it whole. The caller's de-duplication keeps that idempotent.
    let offset = result.offset > stat.size ? 0 : result.offset;
    if (offset >= stat.size) return { ...result, offset };

    fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.allocUnsafe(CHUNK_BYTES);
    let remainder = Buffer.alloc(0);

    while (offset < stat.size) {
      const bytes = fs.readSync(fd, buffer, 0, Math.min(CHUNK_BYTES, stat.size - offset), offset);
      if (bytes <= 0) break;
      const chunk = Buffer.concat([remainder, buffer.subarray(0, bytes)]);

      let start = 0;
      let nl;
      while ((nl = chunk.indexOf(0x0a, start)) !== -1) {
        const line = chunk.subarray(start, nl).toString('utf8');
        start = nl + 1;
        result.lines += 1;
        if (line.trim()) {
          try {
            onEntry(JSON.parse(line));
            result.parsed += 1;
          } catch { /* corrupt line — skip, keep scanning */ }
        }
      }

      remainder = chunk.subarray(start);
      offset += bytes;
    }

    // Consumed bytes = everything except the trailing partial line.
    result.offset = offset - remainder.length;
    return result;
  } catch {
    return result;
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* ignore */ } }
  }
}

module.exports = { listTranscripts, scanFile, CHUNK_BYTES };
