/**
 * plan-table-status.cjs — sub-task statuses recorded in plan.md tables.
 *
 * bk-code's Post Sub-Task Sync sets the Status of each sub-task in plan.md's Sub-Tasks table,
 * and plans written before 0.6.0 record progress *only* there: their sub-task files carry no
 * `status:` frontmatter and no `## Tasks` section. Reading the sub-task files alone showed
 * `sub 1/28` for a fusionworkomni plan whose tables said 01–13, 20, 21b and 23a were done.
 *
 * Shapes seen in real plans, all handled:
 *
 *   | # | Sub-Task | … | Status |              bk-plan template: id in `#`, title in Sub-Task
 *   | 01 | [title](./sub-task-01-x.md) | … | done |
 *   | Sub-task | File | … | Status |            id in a Sub-task column
 *   | 21b | `sub-task-21b-….md` | … | **DONE** (2026-09-24) |
 *   | # | Phase | Sub-tasks | … | Status |       phase table: ranges and lists of ids
 *   | 1 | Contracts | 01–04 | … | done |
 *
 * A Status cell counts only when its first word is a status (`done`, `✅ Done`, `**blocked**`).
 * Free text such as `5.5/6 done` or `20 done, 21 APPROVED, …` is ignored rather than guessed.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const STATUS_CATEGORY = {
  done: 'done', complete: 'done', completed: 'done',
  failed: 'failed', escalated: 'failed', error: 'failed',
  blocked: 'blocked', needs_info: 'blocked',
};

// A cell holding only sub-task ids: `01`, `21b`, `01–04`, `20, 21, 21b`.
const ID_TOKEN = String.raw`\d+[a-z]?(?:\s*[–—-]\s*\d+[a-z]?)?`;
const IDS_ONLY = new RegExp(String.raw`^${ID_TOKEN}(?:\s*,\s*${ID_TOKEN})*$`, 'i');
const MAX_RANGE = 200;

/** `01` → `1`, `21B` → `21b`; null when not an id. */
function normalizeSubTaskId(raw) {
  const m = /^0*(\d+)([a-z]?)$/i.exec(String(raw).trim());
  return m ? String(Number(m[1])) + m[2].toLowerCase() : null;
}

/** Category of a status word or cell: 'done' | 'failed' | 'blocked' | null. */
function statusCategory(text) {
  const clean = String(text || '').replace(/[*`~]/g, '').trim().toLowerCase();
  const m = /^[^a-z0-9]*([a-z][a-z_-]*)/.exec(clean);
  return m ? (STATUS_CATEGORY[m[1]] || null) : null;
}

/** Expand an ids-only cell into normalized ids. */
function expandIds(cell) {
  const ids = [];
  for (const part of cell.split(',')) {
    const range = /^(\d+)[a-z]?\s*[–—-]\s*(\d+)[a-z]?$/i.exec(part.trim());
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (to >= from && to - from <= MAX_RANGE) {
        for (let n = from; n <= to; n++) ids.push(String(n));
        continue;
      }
    }
    const id = normalizeSubTaskId(part);
    if (id) ids.push(id);
  }
  return ids;
}

const splitRow = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
const stripMarkup = (cell) => cell.replace(/[*`]/g, '').trim();

/**
 * Sub-task ids a row is about: the Sub-task(s) column if it holds bare ids, else the `#`
 * column, else sub-task file names referenced anywhere in the row.
 */
function rowIds(cells, idColumns) {
  for (const col of idColumns) {
    const cell = stripMarkup(cells[col] || '');
    if (IDS_ONLY.test(cell)) return expandIds(cell);
  }
  const ids = [];
  for (const m of cells.join('|').matchAll(/sub-task-(\d+[a-z]?)/gi)) {
    const id = normalizeSubTaskId(m[1]);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * @param {string} text — plan.md contents
 * @returns {Map<string, Set<string>>} normalized sub-task id → categories its rows state
 */
function parsePlanTableStatuses(text) {
  const byId = new Map();
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length - 1; i++) {
    if (!/^\s*\|/.test(lines[i]) || !/^\s*\|[\s:|-]+\|?\s*$/.test(lines[i + 1])) continue;
    const header = splitRow(lines[i]).map((h) => stripMarkup(h).toLowerCase());
    const statusCol = header.indexOf('status');
    if (statusCol < 0) continue;
    const idColumns = [
      ...header.flatMap((h, idx) => (/^sub-?tasks?$/.test(h) ? [idx] : [])),
      ...header.flatMap((h, idx) => (h === '#' ? [idx] : [])),
    ];

    let r = i + 2;
    for (; r < lines.length && /^\s*\|/.test(lines[r]); r++) {
      const cells = splitRow(lines[r]);
      const category = statusCategory(cells[statusCol]);
      if (!category) continue;
      for (const id of rowIds(cells, idColumns)) {
        if (!byId.has(id)) byId.set(id, new Set());
        byId.get(id).add(category);
      }
    }
    i = r - 1;
  }
  return byId;
}

/** Statuses from `{planDir}/plan.md`; an empty map when there is no plan.md. */
function readPlanTableStatuses(planDir) {
  try {
    return parsePlanTableStatuses(fs.readFileSync(path.join(planDir, 'plan.md'), 'utf8'));
  } catch {
    return new Map();
  }
}

module.exports = {
  readPlanTableStatuses,
  parsePlanTableStatuses,
  normalizeSubTaskId,
  statusCategory,
};
