/**
 * testing-evidence.cjs — did the `testing` phase of a /bk-code batch actually test anything?
 *
 * Field case (X-Game-Pro KAN-46, kit 0.13.2): `phase_history` shows `testing<-coding` and
 * `review<-testing` with the SAME timestamp, twice, and no bk-unit-test-agent / bk-debugger was
 * ever dispatched. Quality was fine — the plan's own test sub-tasks were written AND run by
 * bk-ios-developer ("Full app suite: 227 tests, 0 failures") — but nothing in the kit told "the
 * tests really ran" from "the phase was skipped". The FSM only checks the edge.
 *
 * Policy (WARN + RECORD, never block): when the workflow leaves `testing` for `review`,
 * decideTestingExit() looks for evidence for the current batch and returns
 *   - the evidence kind, to be recorded in state + phase_history so metrics can tell real testing
 *     from a pass-through;
 *   - an advisory + a yellow-signal when there is none, at most once per batch.
 * It never refuses anything; every failure path returns "no verdict" so a bad plan dir or a
 * malformed state can never dead-end a workflow.
 *
 * Evidence, strongest first:
 *   recorded              the conductor wrote `testing_evidence` (a report path or a note)
 *   test_agent_dispatch   a bk-unit-test-agent / bk-device-test-agent / bk-debugger dispatch in
 *                         `agent_dispatch_history` since the batch's coding began
 *   test_subtask_report   a plan sub-task that is a TESTS sub-task has an implementation/fix
 *                         report under `<plan_dir>/research/` holding a test result line
 *                         (swift test / xcodebuild / flutter test / gradle outcomes)
 *
 * Pure apart from bounded reads of the plan dir (<= 80 sub-task files, <= 3 reports each, each
 * report's last 64 KB) and Date.now().
 */

'use strict';

const fs = require('fs');
const path = require('path');

const TEST_AGENT_RE = /(?:unit|device|ui|integration)-test-agent|^bk-debugger$|(?:^|[-_])test-agent$/i;

const MAX_SUBTASK_FILES = 80;
const MAX_REPORTS_PER_SUBTASK = 3;
const MAX_REPORT_BYTES = 64 * 1024;
const MAX_REF_LENGTH = 300;

/**
 * Lines that say a test run happened and what it came to. Pass OR fail counts — the question is
 * "did tests run", not "are they green" (review judges that). Generic across ios / android /
 * flutter; each pattern is one line of one tool's output or the sentence an agent writes about it.
 */
const RESULT_LINE_PATTERNS = [
  /\*{0,2}\s*TEST (?:SUCCEEDED|FAILED)\s*\*{0,2}/,                       // xcodebuild test
  /Executed\s+\d+\s+tests?,\s+with\s+\d+\s+failures?/i,                   // XCTest / swift test
  /Test Suite '[^']+' (?:passed|failed)/i,                                // XCTest / swift test
  /\b\d+\s+tests?\b[^\n]{0,40}?\b\d+\s+failures?\b/i,                    // "371 tests, 0 failures"
  /\b\d+\s+tests?\b[^\n]{0,40}?\b(?:passed|passing|failed|failing)\b/i,   // "12 tests passed"
  /\b(?:passed|failed)\s*[:=]\s*\d+\b/i,                                  // "passed: 12"
  /\+\d+(?:\s+~\d+)?(?:\s+-\d+)?:\s+(?:all tests passed|some tests failed)/i, // flutter test
  /\b\d+\s+tests?\s+completed,\s+\d+\s+failed\b/i                         // gradle test failure
];

/**
 * A result line must carry a number or a recognised tool outcome token. Bare prose ("tests
 * passed", "no tests failed", "BUILD SUCCESSFUL" with no test task) does NOT count.
 * Gradle prints the task, not a count: a test task line followed within a few lines by BUILD.
 */
const GRADLE_TASK_RE = /\b(?:test\w*UnitTest|connected\w*AndroidTest|gradle(?:w)?\s[^\n]*\btest\b)/i;
const GRADLE_OUTCOME_RE = /\bBUILD (?:SUCCESSFUL|FAILED)\b/;

/** Last `phase_history` entry's start of the batch's coding: first `coding` after the last reset. */
function batchCodingStart(state) {
  const history = Array.isArray(state.phase_history) ? state.phase_history : [];
  const resetTs = typeof state.recurrence_reset_ts === 'number' ? state.recurrence_reset_ts : null;
  for (const e of history) {
    if (!e || typeof e !== 'object' || e.phase !== 'coding' || typeof e.ts !== 'number') continue;
    if (resetTs !== null && e.ts <= resetTs) continue;
    return e.ts;
  }
  return resetTs !== null ? resetTs : 0;
}

/** Batch key used to scope "once per batch". */
function batchKey(state) {
  const n = Number(state.batch);
  return Number.isFinite(n) ? n : 'none';
}

/**
 * A test-agent dispatch recorded since `since`, for this feature.
 * @returns {{agent: string, ts: number}|null}
 */
function findTestAgentDispatch(state, since) {
  const history = Array.isArray(state.agent_dispatch_history) ? state.agent_dispatch_history : [];
  const feature = typeof state.feature === 'string' ? state.feature : null;
  for (let i = history.length - 1; i >= 0; i--) {
    const e = history[i];
    if (!e || typeof e !== 'object' || typeof e.agent !== 'string') continue;
    if (!TEST_AGENT_RE.test(e.agent)) continue;
    if (typeof e.ts === 'number' && e.ts < since) continue;
    if (feature && typeof e.feature === 'string' && e.feature && e.feature !== feature) continue;
    return { agent: e.agent, ts: typeof e.ts === 'number' ? e.ts : 0 };
  }
  return null;
}

/**
 * sub-task number -> batch number, from the plan. Sources: a sub-task's `batch: B2` front-matter,
 * a `| B2 ... | 06 ∥ 07 → 08 |` table row, or an inline `**Batches:** B1 host: 01 → 02 · B2 ...`
 * line (parentheticals with words, like "(∥ 04 may start after 02)", are dropped). Null when
 * nothing parses, so callers fall back rather than warn falsely.
 * @returns {Map<number, number>|null}
 */
function parseBatchMap(planDir, subtaskNames) {
  const map = new Map();
  const known = new Set(subtaskNames.map((n) => Number(/^sub-task-0*(\d+)/i.exec(n)[1])));
  const add = (batch, text) => {
    for (const m of text.matchAll(/(?<![\d.])(\d{2})(?![\d.])/g)) {
      const n = Number(m[1]);
      if (known.has(n) && !map.has(n)) map.set(n, batch);
    }
  };
  try {
    const plan = readTail(path.join(planDir, 'plan.md'));
    for (const line of plan.split('\n')) {
      const row = /^\|\s*B(\d+)\b[^|]*\|([^|]*)\|/.exec(line);
      if (row) { add(Number(row[1]), row[2]); continue; }
      if (/\bBatches?\b/.test(line)) {
        const clean = line.replace(/\([^)]*[A-Za-z]{3,}[^)]*\)/g, ' ');
        for (const seg of clean.split(/[·;]/)) {
          const sm = /\bB(\d+)\b([^]*)/.exec(seg);
          if (sm) add(Number(sm[1]), sm[2].replace(/^[^:]*:/, ''));
        }
      }
    }
  } catch { /* no plan.md: front-matter only */ }
  return map.size > 0 ? map : null;
}

/** Does a sub-task file name / title mark it as a tests sub-task? */
function isTestsSubtask(fileName, head) {
  const slug = fileName.replace(/^sub-task-\d+-?/i, '').replace(/\.md$/i, '');
  if (/(?:^|[-_])tests?(?:[-_]|$)/i.test(slug)) return true;
  const title = /^title:\s*["']?(.+?)["']?\s*$/im.exec(head);
  return Boolean(title && /\btests?\b/i.test(title[1]));
}

/** First line of `text` that is a test result line, trimmed; null when none. */
function findResultLine(text) {
  const lines = text.split('\n');
  let sinceGradleTask = -1;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (RESULT_LINE_PATTERNS.some((re) => re.test(line))) return line.slice(0, 160);
    if (GRADLE_TASK_RE.test(line)) sinceGradleTask = 0;
    else if (sinceGradleTask >= 0 && ++sinceGradleTask <= 8 && GRADLE_OUTCOME_RE.test(line)) return line.slice(0, 160);
  }
  return null;
}

function readTail(file) {
  const stat = fs.statSync(file);
  if (!stat.isFile()) return '';
  const len = Math.min(stat.size, MAX_REPORT_BYTES);
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, stat.size - len);
    return buf.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * A tests sub-task of the plan whose implementation / fix report holds a test result line.
 * @param {string} planDir - absolute
 * @param {{batch?: number|string, since?: number}} [scope] - the current batch and its coding start;
 *   a tests sub-task counts when it is in that batch, or its report is newer than `since`. With
 *   no batch info in the plan every tests sub-task counts (never warn falsely).
 * @returns {{subtask: string, report: string, line: string}|null}
 */
function findTestSubtaskEvidence(planDir, scope = {}) {
  let names;
  try { names = fs.readdirSync(planDir); } catch { return null; }
  const subtasks = names.filter((n) => /^sub-task-\d+.*\.md$/i.test(n)).sort().slice(0, MAX_SUBTASK_FILES);
  if (subtasks.length === 0) return null;

  let reports = null;
  const researchDir = path.join(planDir, 'research');
  try { reports = fs.readdirSync(researchDir); } catch { return null; }

  const batchMap = parseBatchMap(planDir, subtasks);
  const curBatch = Number(scope.batch);
  const scoped = Boolean(batchMap) && Number.isFinite(curBatch) && [...batchMap.values()].includes(curBatch);
  const since = typeof scope.since === 'number' ? scope.since : 0;

  for (const name of subtasks) {
    let head = '';
    try {
      const fd = fs.openSync(path.join(planDir, name), 'r');
      try {
        const buf = Buffer.alloc(2048);
        const n = fs.readSync(fd, buf, 0, 2048, 0);
        head = buf.toString('utf8', 0, n);
      } finally { fs.closeSync(fd); }
    } catch { /* keep whatever head is */ }
    if (!isTestsSubtask(name, head)) continue;

    const num = /^sub-task-0*(\d+)/i.exec(name)[1];
    const fm = /^batch:\s*B?(\d+)/im.exec(head);
    const taskBatch = fm ? Number(fm[1]) : (batchMap ? batchMap.get(Number(num)) : undefined);
    // Batch scoping applies only when the plan says which batch the current one is.
    const inBatch = !scoped || taskBatch === curBatch;
    const numRe = new RegExp('sub-task-0*' + num + '(?!\\d)', 'i');
    const mine = reports
      .filter((r) => /\.md$/i.test(r) && /^(?:impl|fix|test|review)/i.test(r) && numRe.test(r))
      .sort().slice(0, MAX_REPORTS_PER_SUBTASK);
    for (const report of mine) {
      try {
        // A tests sub-task of another batch still counts if its report was written after this
        // batch's coding began (tests living in the last batch, say). Batch 1's old report never does.
        if (!inBatch) {
          if (since <= 0 || fs.statSync(path.join(researchDir, report)).mtimeMs < since) continue;
        }
        const line = findResultLine(readTail(path.join(researchDir, report)));
        if (line) return { subtask: name, report: path.join('research', report), line };
      } catch { /* unreadable report: next one */ }
    }
  }
  return null;
}

/** A declared `testing_evidence` value that carries any content. */
function cleanDeclared(value) {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t ? t.slice(0, MAX_REF_LENGTH) : null;
}

/**
 * Detect the evidence for the batch currently in `testing`. Total: never throws.
 *
 * @param {{state: object, root?: string|null, declared?: string|null, now?: number}} p
 *   declared - `testing_evidence` the same write carries (it beats what is on disk)
 * @returns {{kind: 'recorded'|'test_agent_dispatch'|'test_subtask_report'|'none', ref: string|null}}
 */
function detectTestingEvidence(p) {
  try {
    const state = (p && p.state && typeof p.state === 'object') ? p.state : {};
    const recorded = cleanDeclared(p && p.declared) || cleanDeclared(state.testing_evidence);
    if (recorded) return { kind: 'recorded', ref: recorded };

    const dispatch = findTestAgentDispatch(state, batchCodingStart(state));
    if (dispatch) return { kind: 'test_agent_dispatch', ref: dispatch.agent };

    if (p && p.root && typeof state.plan_dir === 'string' && state.plan_dir) {
      const planDir = path.resolve(p.root, state.plan_dir);
      const found = findTestSubtaskEvidence(planDir, { batch: state.batch, since: batchCodingStart(state) });
      if (found) return { kind: 'test_subtask_report', ref: `${found.report} (${found.subtask}): ${found.line}` };
    }
  } catch { /* fall through: no evidence found, not an error */ }
  return { kind: 'none', ref: null };
}

/** The advisory text: what happened and the two ways to satisfy it. */
function advisoryText(state, healthCli) {
  const feature = state.feature ? ` for "${state.feature}"` : '';
  const batch = state.batch !== undefined && state.batch !== null ? ` batch ${state.batch}` : '';
  return (
    `[TESTING-WITHOUT-EVIDENCE] The workflow left "testing"${feature}${batch} but no test run is on record: ` +
    'no bk-unit-test-agent / bk-debugger dispatch since coding began, and no tests sub-task report with a result line. ' +
    'Advisory only (nothing is blocked). Satisfy it one of two ways:\n' +
    '  1. Dispatch bk-unit-test-agent over the batch\'s ## Test Plan (failures -> bk-debugger -> fix -> re-test).\n' +
    '  2. If developer-run test sub-tasks already ran the suite, record where: ' +
    `${healthCli} --set-phase review --field testing_evidence="<report path or note>" ` +
    '(or set "testing_evidence" in .workflow-state.json).'
  );
}

/**
 * The verdict for a `testing` -> `review` transition.
 *
 * @param {{state: object, root?: string|null, declared?: string|null, healthCli?: string,
 *          now?: number}} p
 * @returns {{kind: string, ref: string|null, patch: object, annotate: string,
 *            advisory: string|null, signal: {type: string, meta: object}|null}|null}
 *   null when no verdict could be reached (the caller carries on as before)
 */
function decideTestingExit(p) {
  try {
    const state = (p && p.state && typeof p.state === 'object') ? p.state : {};
    const now = (p && typeof p.now === 'number') ? p.now : Date.now();
    const batch = batchKey(state);
    const found = detectTestingEvidence(p);

    const result = { batch, kind: found.kind, ref: found.ref, ts: now };
    const patch = { testing_evidence_result: result };
    let advisory = null;
    let signal = null;

    if (found.kind === 'none') {
      // Once per batch: a fix loop re-enters testing and must not be nagged again.
      if (state.testing_evidence_warned_batch !== batch) {
        patch.testing_evidence_warned_batch = batch;
        advisory = advisoryText(state, (p && p.healthCli) || 'node .claude/cli/bk-health/index.cjs');
        signal = {
          type: 'testing_without_evidence',
          meta: { feature: state.feature || null, batch, plan_dir: state.plan_dir || null }
        };
      }
    }
    return { kind: found.kind, ref: found.ref, patch, annotate: found.kind, advisory, signal };
  } catch {
    return null;
  }
}

/**
 * The record a same-phase write earns when it declares `testing_evidence` after the warning
 * (`--set-phase review --field testing_evidence=...`): upgrades a "none" result of this batch to
 * "recorded". Null when there is nothing to upgrade.
 *
 * @param {{state: object, declared?: string|null, now?: number}} p
 * @returns {{testing_evidence_result: object}|null}
 */
function decideTestingRecord(p) {
  try {
    const state = (p && p.state && typeof p.state === 'object') ? p.state : {};
    const declared = cleanDeclared(p && p.declared);
    if (!declared) return null;
    const prior = state.testing_evidence_result;
    const batch = batchKey(state);
    if (!prior || typeof prior !== 'object' || prior.batch !== batch || prior.kind !== 'none') return null;
    return {
      testing_evidence_result: {
        batch, kind: 'recorded', ref: declared,
        ts: (p && typeof p.now === 'number') ? p.now : Date.now()
      }
    };
  } catch {
    return null;
  }
}

module.exports = {
  TEST_AGENT_RE,
  RESULT_LINE_PATTERNS,
  detectTestingEvidence,
  decideTestingExit,
  decideTestingRecord,
  findResultLine,
  findTestSubtaskEvidence,
  parseBatchMap,
  findTestAgentDispatch,
  isTestsSubtask,
  batchKey
};
