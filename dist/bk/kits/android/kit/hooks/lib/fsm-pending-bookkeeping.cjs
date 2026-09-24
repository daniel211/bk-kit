/**
 * fsm-pending-bookkeeping.cjs — Hand fsm-guard's bookkeeping from PreToolUse to PostToolUse.
 *
 * Why this exists: fsm-guard used to write `phase_history`, `phase_recurrence_count` and the
 * new-episode reset into `.workflow-state.json` from PreToolUse — i.e. between the conductor's
 * Read and its Write of that very file. Claude Code refuses a Write whose target changed since
 * it was read ("File content has changed since it was last read"), so every ALLOWED transition
 * written with Write was rejected. In the iOS field repo (X-Game-Pro, 0.10.1) it was worse: the
 * new-episode reset kept `current_phase: "commit"` and changed `feature`, so the retried Write was
 * again a new episode, again mutated the file, and was again rejected — forever. The conductor gave
 * up and a whole feature ran at phase `commit` with the previous feature's plan_dir and batch.
 *
 * So PreToolUse now only decides. What it would have written is stashed here, keyed by the tool
 * call, and PostToolUse — which fires only once the tool has written — merges it onto the file
 * as the tool left it.
 *
 * Store: `bk/dev/shared/.workflow-state.json.fsm-pending`. The name is chosen so that the
 * never-commit rules that already exist cover it without a new entry: `.workflow-state.json.*`
 * in NEVER_COMMIT (src/cli/user-cli/lib/session-state-gitignore.mjs) and the matching regex in
 * post-commit.cjs SESSION_STATE.
 *
 * A record whose tool call never completed (denied by another hook, refused by the user, failed)
 * gets no PostToolUse, so it would sit here forever. Every read reaps records older than
 * PENDING_TTL_MS — "session-scoped files are never reaped" has bitten this kit twice already.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Long enough to outlast a permission prompt the user leaves open for a while — the Write only
 * runs once they answer — and short enough that the file never grows past a handful of records.
 * A record that expires before its PostToolUse only loses that one bookkeeping update (fail-open).
 */
const PENDING_TTL_MS = 60 * 60 * 1000;

/** Absolute path of the pending store, beside the state file it describes. */
function pendingPath(statePath) {
  return statePath + '.fsm-pending';
}

/**
 * The key that ties a PreToolUse to its PostToolUse.
 *
 * `tool_use_id` is on both events in current Claude Code. When it is absent (older runtimes,
 * hand-driven tests), fall back to a digest of the tool input — Pre and Post receive the same
 * `tool_input`, so the digest matches, and two different writes cannot collide.
 *
 * @param {object} input - The hook event
 * @returns {string}
 */
function pendingKey(input) {
  if (input && typeof input.tool_use_id === 'string' && input.tool_use_id) {
    return input.tool_use_id;
  }
  const ti = (input && input.tool_input) || {};
  const material = [
    input && input.tool_name, ti.file_path || ti.path, ti.content, ti.old_string, ti.new_string
  ].map((v) => (v == null ? '' : String(v))).join('\u0000');
  return 'sha1:' + crypto.createHash('sha1').update(material).digest('hex');
}

/** Read the store, dropping expired records. Never throws. */
function readStore(file, now) {
  let store = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) store = parsed;
  } catch { /* missing or corrupt — start empty */ }
  const fresh = {};
  for (const [key, rec] of Object.entries(store)) {
    if (rec && typeof rec.created_at === 'number' && now - rec.created_at < PENDING_TTL_MS) {
      fresh[key] = rec;
    }
  }
  return fresh;
}

/** Write the store atomically, or remove it when empty. Never throws. */
function writeStore(file, store) {
  try {
    if (Object.keys(store).length === 0) {
      try { fs.unlinkSync(file); } catch { /* already gone */ }
      return;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.' + Math.random().toString(36).slice(2);
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
    fs.renameSync(tmp, file);
  } catch { /* fail-open: losing one bookkeeping update never blocks a tool call */ }
}

/**
 * Stash the bookkeeping a PreToolUse decided on, for its PostToolUse to apply.
 *
 * @param {string} statePath - Absolute path of .workflow-state.json
 * @param {string} key - pendingKey(input)
 * @param {{kind: string, patch: object}} record - patch: the fields to merge after the write
 * @param {number} [now]
 */
function stashPending(statePath, key, record, now = Date.now()) {
  const file = pendingPath(statePath);
  const store = readStore(file, now);
  store[key] = { ...record, created_at: now };
  writeStore(file, store);
}

/**
 * Remove and return the record for `key`, reaping expired ones on the way.
 *
 * @param {string} statePath
 * @param {string} key
 * @param {number} [now]
 * @returns {{kind: string, patch: object, created_at: number}|null}
 */
function takePending(statePath, key, now = Date.now()) {
  const file = pendingPath(statePath);
  let exists = false;
  try { exists = fs.existsSync(file); } catch { /* treat as absent */ }
  if (!exists) return null;
  const store = readStore(file, now);
  const record = store[key] || null;
  delete store[key];
  writeStore(file, store);
  return record;
}

module.exports = { PENDING_TTL_MS, pendingPath, pendingKey, stashPending, takePending };
