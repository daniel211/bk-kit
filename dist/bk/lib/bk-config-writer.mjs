/**
 * bk-config-writer.mjs — Safe read-modify-write of the project's `.claude/.bk.json`.
 *
 * `.bk.json` is the user's file: the kit never overwrites it wholesale. Every writer here
 * (e.g. `bk models`) goes through `updateBkConfig`, which
 *  - keeps every key it was not asked to change (key order included),
 *  - starts from `{}` when the file does not exist yet,
 *  - REFUSES to touch a file that is invalid JSON or not a plain object (throws, file left
 *    byte-identical) — unlike kit-drift's `loadConfigFromPath`, which reads leniently and
 *    would silently turn a corrupt file into "no config" and then clobber it on write.
 *
 * Output format: 2-space indent + trailing newline.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Absolute path of the project's `.bk.json`. */
export const bkConfigPath = (targetDir) => join(targetDir, '.claude', '.bk.json');

/** Parse the existing file; `{}` if absent; throw (never overwrite) if corrupt. */
function readStrict(file) {
  if (!existsSync(file)) return {};
  let data;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`${file} is not valid JSON (${err.message}); fix or remove it, nothing was changed.`);
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`${file} must contain a JSON object; nothing was changed.`);
  }
  return data;
}

/**
 * Apply `mutator` to the parsed config and write the result back.
 * @param {string} targetDir — project root containing .claude/
 * @param {(obj: object) => (object|void)} mutator — returns a new object, or mutates and returns nothing
 * @returns {object} the config that was written
 */
export function updateBkConfig(targetDir, mutator) {
  const file = bkConfigPath(targetDir);
  const current = readStrict(file);
  const returned = mutator(current);
  const next = returned === undefined ? current : returned;
  if (next === null || typeof next !== 'object' || Array.isArray(next)) {
    throw new Error('updateBkConfig: mutator must produce a plain object.');
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
  return next;
}

/**
 * Set the `models` key of a config object; delete it when the map is empty/absent.
 * Mutates and returns `obj` so it can be used directly as a mutator body.
 * @param {object} obj
 * @param {Record<string,{model?:string,effort?:string}>|null|undefined} models
 */
export function setModelsKey(obj, models) {
  if (models && Object.keys(models).length > 0) obj.models = models;
  else delete obj.models;
  return obj;
}

/** Convenience: persist a `models` map (or remove the key when empty) in `.bk.json`. */
export function writeModels(targetDir, models) {
  return updateBkConfig(targetDir, (obj) => setModelsKey(obj, models));
}
