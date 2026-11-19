/**
 * prompt-inject-state.cjs — what prompt-context-inject last said in this session, so it can
 * stay quiet when it would only say it again.
 *
 * Field evidence (X-Game-Pro, kit 0.12.x, 6 conductor sessions): prompt-context-inject fired
 * 499 times at ~660 chars each, and the text was almost always the same block —
 *   ## Language … / Workflow: bk-code | Phase: commit | Feature: quick-session-create | Tier:
 *   Complex / Plan: … / === EFFORT GUIDANCE (complexity: complex) === …
 * Most of those 499 prompts were not the user at all: Claude Code submits every background
 * `<task-notification>` and every subagent hand-back as a user-role turn, and UserPromptSubmit
 * fires for each. Every injection stays in the conductor's history and is re-read on every
 * later request, so a repeated block is paid for again and again for the rest of the session.
 *
 * So the hook keeps, per session: the hash of the last block it injected and how many real user
 * prompts it has seen (the T1/T2 cadence counter, which used to be ONE file in os.tmpdir()
 * shared by every session and project on the machine). It injects the block only when the hash
 * changes, and skips automated prompts outright.
 *
 * One file per session, `.bk-metrics/prompt-inject/<session>.json`, next to the other
 * session-scoped state (conductor-inbox, lint-queue). Session-scoped files that nobody reaps are
 * a recurring defect in this kit, so this one is reaped from its first version: session-init
 * sweeps files idle for 24h, and resets the current session's file on `clear` / `compact` —
 * after a compaction the earlier injection is gone from the context, so "unchanged since last
 * time" no longer means "already in front of the model".
 *
 * Nothing here throws: unreadable state reads as "never injected", which means inject.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/** Same TTL as the conductor inbox and lint queue reapers, for the same reason. */
const PROMPT_INJECT_STALE_TTL_MS = 24 * 60 * 60 * 1000;

function stateDir(root) {
  return path.join(root, '.bk-metrics', 'prompt-inject');
}

/** Same sanitization conductor-inbox applies to session ids used as filenames. */
function stateFile(root, sessionId) {
  const safe = String(sessionId).replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 120);
  return path.join(stateDir(root), `${safe}.json`);
}

/** Short content hash — collisions only cost one skipped injection. */
function contentHash(text) {
  return crypto.createHash('sha1').update(String(text)).digest('hex').slice(0, 16);
}

/**
 * Is this "prompt" something Claude Code submitted on its own rather than the user?
 *
 * Three framings seen in conductor transcripts: a background task's completion arrives as a
 * turn starting with `<task-notification>`; a subagent/session hand-back arrives framed as
 * `[Subagent hand-back]` or "Another Claude session sent a message". The state the hook would
 * inject cannot have changed because of the wording of such a turn, and the user did not ask
 * anything — there is nothing to remind anyone of.
 *
 * Only the head of the prompt is checked, so a user who pastes one of these into a longer
 * message of their own is still treated as the user.
 *
 * @param {string} prompt
 * @returns {boolean}
 */
function isAutomatedPrompt(prompt) {
  if (typeof prompt !== 'string' || !prompt) return false;
  const head = prompt.trimStart().slice(0, 300);
  if (head.startsWith('<task-notification>')) return true;
  if (head.startsWith('[Subagent hand-back]')) return true;
  return /Another Claude session sent a message/.test(head);
}

/**
 * @returns {{hash: string|null, count: number}} — a fresh state when missing or unreadable
 */
function readPromptInjectState(root, sessionId) {
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile(root, sessionId), 'utf8'));
    return {
      hash: typeof parsed.hash === 'string' ? parsed.hash : null,
      count: Number.isInteger(parsed.count) && parsed.count >= 0 ? parsed.count : 0
    };
  } catch {
    return { hash: null, count: 0 };
  }
}

/** Best-effort write: a lost write only means the next prompt injects once more. */
function writePromptInjectState(root, sessionId, state) {
  try {
    fs.mkdirSync(stateDir(root), { recursive: true });
    const file = stateFile(root, sessionId);
    const tmp = file + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ hash: state.hash || null, count: state.count || 0, updatedAt: Date.now() }));
    fs.renameSync(tmp, file);
  } catch { /* ignore */ }
}

/** Forget what this session was told — the next prompt injects in full. */
function resetPromptInjectState(root, sessionId) {
  try { fs.unlinkSync(stateFile(root, sessionId)); } catch { /* nothing to reset */ }
}

/**
 * Delete other sessions' files idle for longer than the TTL.
 * @param {string} root
 * @param {{currentSessionId?: string|null, ttlMs?: number, now?: number}} [options]
 * @returns {number} files removed
 */
function reapStalePromptInjectStates(root, options = {}) {
  try {
    const ttlMs = typeof options.ttlMs === 'number' ? options.ttlMs : PROMPT_INJECT_STALE_TTL_MS;
    const nowMs = typeof options.now === 'number' ? options.now : Date.now();
    const own = options.currentSessionId ? path.basename(stateFile(root, options.currentSessionId)) : null;
    let entries;
    try { entries = fs.readdirSync(stateDir(root), { withFileTypes: true }); } catch { return 0; }
    let removed = 0;
    for (const entry of entries) {
      try {
        if (!entry.isFile() || entry.name === own) continue;
        const full = path.join(stateDir(root), entry.name);
        if (nowMs - fs.statSync(full).mtimeMs < ttlMs) continue;
        fs.unlinkSync(full);
        removed += 1;
      } catch { /* one bad entry must not stop the sweep */ }
    }
    return removed;
  } catch {
    return 0; // housekeeping, never a precondition
  }
}

module.exports = {
  PROMPT_INJECT_STALE_TTL_MS,
  stateFile,
  contentHash,
  isAutomatedPrompt,
  readPromptInjectState,
  writePromptInjectState,
  resetPromptInjectState,
  reapStalePromptInjectStates
};
