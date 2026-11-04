/**
 * telemetry-sanitizer.mjs — Rewrite one telemetry row so only its allowlisted fields survive.
 *
 * Names are hashed with HMAC-SHA256 under a salt made fresh for each export and never written
 * down. A plain SHA-256 would not hide anything here: feature names are short guessable words,
 * so `sha256('crypto-module')` falls to a dictionary in seconds. The same name still maps to the
 * same hash inside one bundle, so rows join across files; two bundles cannot be joined.
 */

import { createHmac } from 'node:crypto';

export const REDACTED = '[redacted]';

const TOKEN = /^[A-Za-z0-9_.:-]{1,64}$/;
const ISO_TS = /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPAQUE_ID = [UUID, /^agent-[0-9a-f]{8,32}\.jsonl$/, /^a[0-9a-f]{8,32}$/, /^sg_\d+_[a-z0-9]+$/];
const KIT_NAME = /^bk-[a-z0-9-]{1,48}$/;
const BUILTIN_AGENTS = new Set([
  'general-purpose', 'Explore', 'Plan', 'claude', 'claude-code-guide', 'statusline-setup', 'unknown',
]);
const BUILTIN_TOOL = /^[A-Z][A-Za-z]{1,40}$/;
const KIT_TOOLS = new Set(['bk-health --set-phase']);

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Build a row sanitizer around one salt.
 *
 * @param {object} args
 * @param {Buffer} args.salt — random per export; the caller must not persist it
 * @param {Set<string>} [args.kitScripts] — hook script names the installed kit shipped
 * @returns {{sanitizeRow: Function, hashedOriginals: Set<string>, stats: {dropped:number, redacted:number}}}
 */
export function createSanitizer({ salt, kitScripts = new Set() }) {
  const hashedOriginals = new Set();
  const stats = { dropped: 0, redacted: 0 };
  const DROP = Symbol('drop');

  const hash = (value) => {
    hashedOriginals.add(value);
    return `h_${createHmac('sha256', salt).update(value).digest('hex').slice(0, 12)}`;
  };

  const token = (v) => {
    if (v === '' || v === null) return v;
    if (typeof v === 'string' && TOKEN.test(v)) return v;
    stats.redacted += 1;
    return REDACTED;
  };

  const readableOr = (isReadable) => (v) => {
    if (v === null || v === '') return v;
    if (typeof v !== 'string') return DROP;
    return isReadable(v) ? v : hash(v);
  };

  const workflow = (v) => {
    if (v === null || v === '') return v;
    if (typeof v !== 'string') return DROP;
    const cut = v.indexOf(':');
    if (cut < 0) return hash(v);
    const [prefix, rest] = [v.slice(0, cut), v.slice(cut + 1)];
    // `session:<uuid>` joins session_id, but `session:quan-ly-du-an` is a feature in disguise.
    if (prefix === 'session' && UUID.test(rest)) return v;
    const safePrefix = prefix === 'session' || KIT_NAME.test(prefix) ? prefix : hash(prefix);
    return `${safePrefix}:${hash(rest)}`;
  };

  const tool = (v) => {
    if (v === null || v === '') return v;
    if (typeof v !== 'string') return DROP;
    if (BUILTIN_TOOL.test(v) || KIT_TOOLS.has(v)) return v;
    return v.startsWith('mcp__') ? `mcp__${hash(v)}` : hash(v);
  };

  const classes = {
    keep: (v) => (v === null || typeof v === 'number' || typeof v === 'boolean' ? v : DROP),
    ts: (v) => (typeof v === 'number' || (typeof v === 'string' && ISO_TS.test(v)) ? v : DROP),
    token,
    tokens: (v) => (Array.isArray(v) ? v.map(token) : DROP),
    id: readableOr((v) => OPAQUE_ID.some((re) => re.test(v))),
    hash: (v) => (typeof v === 'string' && v !== '' ? hash(v) : DROP),
    feature: readableOr((v) => v === 'unknown'),
    workflow,
    agent: readableOr((v) => KIT_NAME.test(v) || BUILTIN_AGENTS.has(v)),
    skill: readableOr((v) => KIT_NAME.test(v) || v === 'unknown'),
    tool,
    script: readableOr((v) => kitScripts.has(v)),
  };

  const applyFields = (row, fields) => {
    const out = {};
    for (const [key, value] of Object.entries(row)) {
      const cls = Object.hasOwn(fields, key) ? fields[key] : null;
      const next = cls === null ? DROP : applyClass(value, cls);
      if (next === DROP) stats.dropped += 1;
      else out[key] = next;
    }
    return out;
  };

  const applyClass = (value, cls) => {
    if (typeof cls === 'string') return classes[cls](value);
    if (cls.object) return isPlainObject(value) ? applyFields(value, cls.object) : DROP;
    if (!Array.isArray(value)) return DROP;
    return value.filter(isPlainObject).map((item) => applyFields(item, cls.arrayOf));
  };

  return { sanitizeRow: applyFields, hashedOriginals, stats };
}
