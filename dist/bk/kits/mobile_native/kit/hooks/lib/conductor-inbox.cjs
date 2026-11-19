/**
 * conductor-inbox.cjs — carry a message from SubagentStop to the main conversation.
 *
 * verify-output and agent-signal-detector judge an agent at SubagentStop, the only event that
 * fires when it actually finishes (see verify-output.cjs for why PostToolUse no longer can).
 * But SubagentStop output never reaches the conductor. Measured 2026-09-23: skill-chain-suggest's
 * `[SUGGEST-NEXT] bk-code complete (phase: commit). Next: /bk-docs` exists ONLY inside the
 * subagent's own transcript, as a `hook_success` attachment with `content: ""` — in X-Game-Pro
 * (d0186d72…/subagents/agent-a6722278dade32579.jsonl) and in fusionworkomni
 * (22cf27fc…/subagents/agent-abde7f4fe706b884b.jsonl) — and in no main-session transcript.
 *
 * So the judgement stays on SubagentStop and the words travel separately: posted here, keyed by
 * the session that dispatched the agent (a SubagentStop's session_id is the parent's — the
 * `spawn` row written at the main session's PreToolUse(Agent) and the `stop` row written at
 * SubagentStop carry the same session_id in X-Game-Pro's subagent-live.jsonl), and drained by
 * conductor-inbox-drain.cjs on the next main-session event.
 *
 * One file per session, `.bk-metrics/conductor-inbox/<session>.jsonl`. Per-session files are
 * what keep one session's rejections out of another's conversation: a drain can only ever open
 * its own. The claim is by rename, as in lint-findings-store.cjs, so a message is delivered
 * once even when PreToolUse and PostToolUse drains race.
 *
 * Two ways in: a hook posts directly (verify-output, agent-signal-detector, complexity-detector,
 * plan-complete-reminder, skill-chain-suggest), or it prints on SubagentStop and bk-dispatch
 * routes the text here (lib/hook-dispatch-output.cjs shapeForEvent) — the safety net for any
 * SubagentStop hook added later. Either way a producer must NOT run its text through the
 * injection budget: the drain budgets on delivery, and a hash already charged at SubagentStop
 * reads as a duplicate of itself and is never delivered.
 *
 * Exports:
 *   postToConductor(root, sessionId, { source, text, key? }) — queue, deduped against pending
 *   takeInbox(root, sessionId)   — claim every pending message for this session
 *   requeue(root, sessionId, records) — put back what the injection budget refused
 *   reapStaleInboxes(root, { currentSessionId?, ttlMs?, now? })
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * 24 hours, the lint-queue reaper's TTL and for the same reason: the directory is shared by
 * every session in the repo, and a file whose mtime has not moved in a day cannot belong to a
 * live conversation. Session-scoped files that nobody reaps are a recurring defect in this kit
 * (orphan subagent spawns, stale lint queues) — this one is reaped from its first version.
 */
const INBOX_STALE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * A message the injection budget keeps refusing is dropped after this many drains rather than
 * riding along forever. Three is enough to outlast one saturated turn.
 */
const MAX_DELIVERY_ATTEMPTS = 3;

function inboxDir(root) {
  return path.join(root, '.bk-metrics', 'conductor-inbox');
}

/** Same sanitization lint-queue applies to session ids used as filenames. */
function inboxFile(root, sessionId) {
  const safe = String(sessionId).replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 120);
  return path.join(inboxDir(root), `${safe}.jsonl`);
}

function parseLines(raw) {
  const out = [];
  for (const line of String(raw || '').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const rec = JSON.parse(t);
      if (rec && typeof rec.text === 'string' && rec.text.trim()) out.push(rec);
    } catch { /* skip one bad line, keep the batch */ }
  }
  return out;
}

const keyOf = (source, text) =>
  crypto.createHash('sha1').update(`${source}\n${text}`).digest('hex').slice(0, 16);

/**
 * Queue a message for this session's conductor. A message identical to one still pending is
 * not queued twice. Without a session id there is no conductor to address, so nothing is
 * queued — the same rule the injection budget applies.
 *
 * @returns {boolean} whether a record was written
 */
function postToConductor(root, sessionId, message) {
  try {
    if (!root || !sessionId || !message || typeof message.text !== 'string' || !message.text.trim()) {
      return false;
    }
    const source = message.source || 'unknown';
    const key = message.key || keyOf(source, message.text);
    const file = inboxFile(root, sessionId);

    let pending = [];
    try { pending = parseLines(fs.readFileSync(file, 'utf8')); } catch { /* none yet */ }
    if (pending.some((r) => r.key === key)) return false;

    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify({
      ts: Date.now(), session_id: String(sessionId), source, key, text: message.text, attempts: 0
    }) + '\n', 'utf8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Claim every pending message for this session: rename aside, read, delete. Records are
 * de-duplicated by key and returned oldest first.
 */
function takeInbox(root, sessionId) {
  if (!root || !sessionId) return [];
  const file = inboxFile(root, sessionId);
  const claim = `${file}.claiming-${process.pid}-${Date.now()}`;
  try {
    if (!fs.existsSync(file)) return [];
    fs.renameSync(file, claim);
  } catch {
    return []; // a concurrent drain won the race
  }
  let raw = '';
  try { raw = fs.readFileSync(claim, 'utf8'); } catch { raw = ''; }
  try { fs.unlinkSync(claim); } catch { /* fail-open */ }

  const seen = new Set();
  const out = [];
  for (const rec of parseLines(raw)) {
    const k = rec.key || keyOf(rec.source, rec.text);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(rec);
  }
  return out;
}

/**
 * Put back messages the injection budget refused this time, one attempt older. Messages past
 * MAX_DELIVERY_ATTEMPTS are dropped.
 *
 * @returns {number} how many were requeued
 */
function requeue(root, sessionId, records) {
  let n = 0;
  for (const rec of records || []) {
    const attempts = (Number(rec.attempts) || 0) + 1;
    if (attempts >= MAX_DELIVERY_ATTEMPTS) continue;
    try {
      const file = inboxFile(root, sessionId);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, JSON.stringify({ ...rec, attempts }) + '\n', 'utf8');
      n += 1;
    } catch { /* fail-open */ }
  }
  return n;
}

/**
 * Delete inboxes (and claim files left by a crashed drain) untouched for the TTL. The current
 * session's own inbox is never touched, whatever its age — a resumed session can own one.
 *
 * @returns {number} files removed
 */
function reapStaleInboxes(root, options = {}) {
  try {
    const ttlMs = typeof options.ttlMs === 'number' ? options.ttlMs : INBOX_STALE_TTL_MS;
    const nowMs = typeof options.now === 'number' ? options.now : Date.now();
    const own = options.currentSessionId ? path.basename(inboxFile(root, options.currentSessionId)) : null;

    let entries;
    try { entries = fs.readdirSync(inboxDir(root), { withFileTypes: true }); } catch { return 0; }

    let removed = 0;
    for (const entry of entries) {
      try {
        if (!entry.isFile() || entry.name === own) continue;
        const full = path.join(inboxDir(root), entry.name);
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
  postToConductor,
  takeInbox,
  requeue,
  reapStaleInboxes,
  inboxFile,
  INBOX_STALE_TTL_MS,
  MAX_DELIVERY_ATTEMPTS
};
