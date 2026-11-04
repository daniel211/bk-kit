/**
 * telemetry-gate.mjs — Last check on a staged telemetry bundle, independent of the allowlist.
 *
 * The allowlist decides by field name, so a kit-owned field holding something it should not
 * (a path in a `status`, say) passes it. This scan looks at the values themselves. A hit stops
 * the export: a bundle that fails to appear is an annoyance, a leaked path is not recoverable.
 * Findings name the file and field only — repeating the value would print what it just caught.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const LEAK = new RegExp([
  '/Users/', '/home/', '[A-Za-z]:\\\\',
  '[\\w-]\\.(swift|dart|kt|kts|java|m|mm|h|ts|tsx|jsx|py|gradle|xib|storyboard|plist|md)\\b',
  '\\b(func|class|enum|struct|import|public|private|def|interface)\\s+\\w',
].join('|'));

// Words the kit itself writes as phase or row types. A feature called `testing` is a real name,
// but finding that word in a `phase` field says nothing about a leak.
const KIT_WORDS = new Set([
  'plan', 'planning', 'coding', 'testing', 'review', 'commit', 'completed', 'session', 'subagent',
  'unknown', 'start', 'stop', 'spawn', 'ok', 'error',
]);

/** Depth-first walk over every string in a JSON value, with its dotted field name. */
function walkStrings(value, field, visit) {
  if (typeof value === 'string') visit(value, field);
  else if (Array.isArray(value)) value.forEach((v) => walkStrings(v, field, visit));
  else if (typeof value === 'object' && value !== null) {
    for (const [k, v] of Object.entries(value)) {
      visit(k, field ? `${field}.${k}` : k);
      walkStrings(v, field ? `${field}.${k}` : k, visit);
    }
  }
}

/**
 * Scan every file in a staged bundle.
 *
 * @param {string} dir — the staged bundle directory
 * @param {Iterable<string>} originals — the plain names that were hashed; none may survive
 * @returns {{file:string, field:string, kind:'path-or-source'|'original-name'}[]} one per field
 */
export function scanStagedBundle(dir, originals) {
  const names = new Set([...originals].filter((n) => !KIT_WORDS.has(n) && !/^bk-/.test(n)));
  const seen = new Map();
  const report = (file, field, kind) => seen.set(`${file}\0${field}\0${kind}`, { file, field, kind });

  for (const file of readdirSync(dir)) {
    const rows = readFileSync(join(dir, file), 'utf8').split('\n').filter(Boolean);
    for (const line of rows) {
      walkStrings(JSON.parse(line), '', (text, field) => {
        if (LEAK.test(text)) report(file, field, 'path-or-source');
        if (names.has(text) || text.split(/[:/]/).some((part) => names.has(part))) {
          report(file, field, 'original-name');
        }
      });
    }
  }
  return [...seen.values()];
}
