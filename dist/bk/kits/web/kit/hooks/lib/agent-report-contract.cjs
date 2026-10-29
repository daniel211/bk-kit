/**
 * agent-report-contract.cjs — which file, if any, a finished agent was obliged to write.
 *
 * verify-output used to expect `bk/dev/shared/reports/<agent>-<feature>.md` from EVERY agent:
 * getOutputPath fell back to that name for anything outside its map. The real contracts differ,
 * and in X-Game-Pro on 2026-09-23 (kit 0.10.1) `.retry-state.json` filled with rejections that
 * were all false:
 *
 *   bk-researcher@bk-code:crypto-module   MISSING …/shared/reports/researcher-crypto-module.md
 *   bk-planner@bk-code:crypto-module      MISSING …/shared/reports/planner-crypto-module.md
 *   bk-git-manager@bk-code:crypto-module  MISSING …/shared/reports/git-manager-crypto-module.md
 *   bk-code-reviewer@bk-code:crypto-module MISSING …/shared/reports/code-review-crypto-module.md
 *
 * while the same repo held bk/dev/crypto-module/research/researcher-1-domain.md,
 * bk/dev/crypto-module/plan.md, and shared/reports/code-review-ios-project-init-batch{1,2,3}.md.
 * bk-git-manager commits; it has no report at all.
 *
 * So a contract here is a LIST of acceptable locations, each one taken from a place the kit
 * itself tells the agent to write (the agent definition, a skill's dispatch prompt, or the
 * path tables in rules/conductor-brief.md, team-rules.md and agent-protocols/output-gate.md),
 * because those sources do not agree with each other and the conductor follows whichever one
 * it read. An agent that is not in CONTRACTS has no report obligation and can never be
 * rejected for a missing file — that is the default, not the exception.
 *
 * The list was still not enough. In X-Game-Pro on 2026-09-25 (kit 0.12.1) 11 of 13
 * `[AGENT-OUTPUT-REJECTED]` were false, every one an agent that wrote its report under a name
 * the list did not hold:
 *
 *   bk-code-reviewer (as the /bk-plan critic)  {plan-dir}/research/critic-review.md   MISSING x3
 *     — the exact path bk-plan/references/agent-dispatch.md tells the critic to write
 *   bk-code-reviewer   shared/reports/code-review-device-identity-auth-b1.md, -b2.md  MISSING x2
 *   bk-unit-test-agent {plan-dir}/research/test-report-b1.md, test-report-b2.md      MISSING
 *   bk-unit-test-agent {plan-dir}/research/review-fix-batch-1.md    STALE vs an old test-batch-1.md
 *   bk-brainstormer    {plan-dir}/research/reactive-brainstorm-batch2-tests.md        MISSING
 *   bk-security-auditor (realtime-authorization)                                      MISSING
 *
 * Each one raised agent_stuck, which forced a bk-brainstormer dispatch nobody needed, and the
 * conductor learned to wave the check off as "false-positive path-naming". The conductor names
 * the output path in its dispatch prompt, and the kit documents many conventions; chasing them
 * with globs keeps failing one new name at a time.
 *
 * So the primary evidence is what the agent itself wrote during this run: its own transcript
 * (lib/agent-run-evidence.cjs) records every Write/Edit/MultiEdit with its `file_path`. A
 * contracted agent that wrote any `.md` under `bk/` has written its report, whatever it called
 * it — status 'found' with that path. That is also freshness by construction: the write is in
 * this run's transcript, so no mtime comparison is needed.
 *
 * The glob list below is the FALLBACK, used when the transcript shows no such write: the
 * transcript is missing or unreadable, or the agent wrote its report through Bash
 * (`cat > … <<EOF`), which is not parsed. It keeps the freshness rule: when the agent's start
 * time is known (the first line of its transcript) a candidate only counts if it was modified
 * during the run, because a report left by a previous dispatch is exactly what a re-dispatched
 * agent that did nothing would otherwise be credited with. Without a start time the check
 * degrades to existence, which is what it always was. The fallback names were widened with
 * the field names above (`-bN`, critic-review.md, test-report-*.md, *brainstorm*.md) so that
 * it is less wrong, not so that it is complete.
 *
 * The old researcher weakness — parallel researchers share one glob (`researcher-*.md`), so a
 * researcher that wrote nothing was credited with a sibling's file — is gone for every
 * researcher that wrote with a file tool: it is credited with its own write. It remains only
 * in the fallback, i.e. for a researcher that wrote nothing at all while a sibling wrote in
 * the same window. That is kept on purpose: a false rejection costs a wasted agent and the
 * conductor's trust in this check; a missed one costs a thin plan the planner will notice.
 */

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * mtime and the transcript timestamp come from the same machine clock, but some filesystems
 * store mtime at 1s (or 2s, FAT) granularity. A report written in the agent's first second
 * must not read as older than the agent.
 */
const MTIME_TOLERANCE_MS = 2000;

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Optional batch suffix on a shared/reports name: `-batch2` (bk-code's reviewer in the field),
 * `-b1` (X-Game-Pro 2026-09-25, code-review-device-identity-auth-b1.md), `-batch-3`.
 */
const BATCH = '(?:-(?:batch|b)-?\\d+)?';

/**
 * Per agent (bk- prefix stripped): candidate locations as { dir, show, re, why } — `show` is
 * the name as a person reads it in a rejection message, `re` the exact match. `dir` is one of
 * 'reports' (bk/dev/shared/reports), 'planResearch' ({plan_dir}/research), 'plan'
 * ({plan_dir}), 'featureDir' (bk/dev/{feature}) or 'devResearch' (bk/dev/research). A
 * candidate whose directory cannot be resolved from workflow state is dropped; if all are
 * dropped the contract is unresolvable and nothing is checked.
 *
 * A batch suffix (BATCH) is accepted on every shared/reports name: bk-code reviews per batch,
 * and field reviewers wrote code-review-ios-project-init-batch1.md … batch3.md and
 * code-review-device-identity-auth-b1.md.
 */
const CONTRACTS = {
  'code-reviewer': ({ f, F }) => [
    { dir: 'reports', show: `code-review-${F}[-batchN].md`, re: new RegExp(`^code-review-${f}${BATCH}\\.md$`), why: 'agents/bk-code-reviewer.md' },
    { dir: 'planResearch', show: 'review-batch-N.md', re: /^review-batch-\d+(?:-retry)?\.md$/, why: 'bk-code batch-execution.md' },
    // bk-plan dispatches bk-code-reviewer as its critic, and that prompt names this file.
    { dir: 'planResearch', show: 'critic-review.md', re: /^critic-review\.md$/, why: 'bk-plan agent-dispatch.md' }
  ],
  'gemini-reviewer': ({ f, F }) => [
    { dir: 'reports', show: `code-review-gemini-${F}[-batchN].md`, re: new RegExp(`^code-review-gemini-${f}${BATCH}\\.md$`), why: 'agents/bk-gemini-reviewer.md' }
  ],
  'codex-reviewer': ({ f, F }) => [
    { dir: 'reports', show: `code-review-codex-${F}[-batchN].md`, re: new RegExp(`^code-review-codex-${f}${BATCH}\\.md$`), why: 'agents/bk-codex-reviewer.md' }
  ],
  'security-auditor': ({ f, F }) => [
    { dir: 'reports', show: `security-${F}[-batchN].md`, re: new RegExp(`^security-${f}${BATCH}\\.md$`), why: 'agents/bk-security-auditor.md' },
    { dir: 'planResearch', show: 'review-security-batch-N.md', re: /^review-security-batch-\d+\.md$/, why: 'bk-code batch-execution.md' }
  ],
  'performance-analyzer': ({ f, F }) => [
    { dir: 'reports', show: `performance-${F}[-batchN].md`, re: new RegExp(`^performance-${f}${BATCH}\\.md$`), why: 'agents/bk-performance-analyzer.md' }
  ],
  'unit-test-agent': ({ f, F, p, P }) => [
    { dir: 'reports', show: `unit-test-${P}-${F}[-batchN].md`, re: new RegExp(`^unit-test-${p}-${f}${BATCH}\\.md$`), why: 'agents/bk-unit-test-agent.md' },
    { dir: 'planResearch', show: 'test-batch-N*.md', re: /^test-batch-\d+(?:-[\w-]+)?\.md$/, why: 'bk-code batch-execution.md' },
    // Not in any kit document — what the X-Game-Pro conductor asked for, and got, three times
    // (bk/dev/ios-project-init/research/unit-test-batch{1,2,3}.md). Rejecting the report an
    // agent was actually told to write is the bug this file exists to fix.
    { dir: 'planResearch', show: 'unit-test-batchN.md', re: /^unit-test-batch\d+\.md$/, why: 'observed in the field' },
    // Also not documented: X-Game-Pro 2026-09-25, test-report-b1.md and test-report-b2.md.
    { dir: 'planResearch', show: 'test-report*.md', re: /^test-report(?:-[\w-]+)?\.md$/, why: 'observed in the field' },
    // The plan's sub-task Output convention: X-Game-Pro 2026-10-07, test-sub-task-09a.md,
    // -09b-lintfix.md, -10b.md, -11.md.
    { dir: 'planResearch', show: 'test-sub-task-NN*.md', re: /^test-sub-task-\d+[a-z]*(?:-[\w-]+)?\.md$/, why: 'plan sub-task Output convention' }
  ],
  'device-test-agent': ({ f, F, p, P }) => [
    { dir: 'reports', show: `device-test-${P}-${F}[-batchN].md`, re: new RegExp(`^device-test-${p}-${f}${BATCH}\\.md$`), why: 'agents/bk-device-test-agent.md' }
  ],
  'test-architect': ({ f, F }) => [
    { dir: 'reports', show: `test-strategy-${F}.md`, re: new RegExp(`^test-strategy-${f}\\.md$`), why: 'agents/bk-test-architect.md' }
  ],
  'brainstormer': ({ f, F }) => [
    { dir: 'reports', show: `brainstorm-${F}.md`, re: new RegExp(`^brainstorm-${f}\\.md$`), why: 'agents/bk-brainstormer.md' },
    // The reactive (agent_stuck) dispatch writes next to the plan: X-Game-Pro 2026-09-25,
    // research/reactive-brainstorm-batch2-tests.md.
    { dir: 'planResearch', show: '*brainstorm*.md', re: /^[\w-]*brainstorm[\w-]*\.md$/, why: 'observed in the field' }
  ],
  // Three documents, three locations: bk-plan's dispatch prompt, bk-debug's analyze phase, and
  // the agent's own definition.
  'researcher': ({ f, F }) => [
    { dir: 'planResearch', show: 'researcher-*.md', re: /^researcher-[\w-]+\.md$/, why: 'bk-plan agent-dispatch.md' },
    { dir: 'reports', show: `research-${F}.md`, re: new RegExp(`^research-${f}\\.md$`), why: 'bk-debug analyze-phase.md' },
    { dir: 'devResearch', show: `${F}-research.md`, re: new RegExp(`^${f}-research\\.md$`), why: 'agents/bk-researcher.md' }
  ],
  'planner': () => [
    { dir: 'plan', show: 'plan.md', re: /^plan\.md$/, why: 'rules/conductor-brief.md' },
    { dir: 'featureDir', show: 'plan.md', re: /^plan\.md$/, why: 'agents/bk-planner.md' }
  ]
};

/**
 * Report files under bk/dev/shared/reports/** are the ones rules/agent-protocols/output-gate.md
 * governs (its `paths:` front matter), so only they are held to its `## ` header, metadata
 * footer and required-section checks. A plan.md or a research note has its own format.
 */
function isGatedReport(filePath, reportsDir) {
  return filePath.startsWith(reportsDir + path.sep) && filePath.endsWith('.md');
}

/**
 * @param {string} agentType
 * @param {{ root: string, reportsDir: string, feature?: string|null, platform?: string|null, planDir?: string|null }} ctx
 * @returns {Array<{ dir: string, re: RegExp, why: string }>|null} null — no report contract
 */
function candidatesFor(agentType, ctx) {
  const bare = String(agentType || '').replace(/^bk-/, '');
  const build = CONTRACTS[bare];
  if (!build) return null;

  const feature = ctx.feature || null;
  const dirs = {
    reports: feature ? ctx.reportsDir : null,
    planResearch: ctx.planDir ? path.join(ctx.planDir, 'research') : null,
    plan: ctx.planDir || null,
    featureDir: feature ? path.join(ctx.root, 'bk', 'dev', feature) : null,
    devResearch: feature ? path.join(ctx.root, 'bk', 'dev', 'research') : null
  };

  const specs = build({
    f: esc(feature || ''),
    F: feature || '',
    p: ctx.platform ? esc(ctx.platform) : '[a-z]+',
    P: ctx.platform || '{platform}'
  });

  return specs
    .filter((s) => dirs[s.dir])
    .map((s) => ({ ...s, absDir: dirs[s.dir] }));
}

/** realpath when the file exists, else the normalised path — macOS tmp and project dirs are
 * reached through /var → /private/var, and a hook's cwd is always the resolved form. */
function real(p) {
  try { return fs.realpathSync(p); } catch { return path.resolve(p); }
}

/**
 * The report this run wrote, from the agent's own file-tool calls: the last `.md` under
 * `<root>/bk/` that still exists. A write that also matches a contract candidate wins over
 * one that does not, so a reviewer that jotted a scratch note and then wrote its report is
 * judged (and format-checked) on the report.
 *
 * @param {string[]} written — file_path of each Write/Edit/MultiEdit, in call order
 * @param {{ root: string }} ctx
 * @param {Array<{ absDir: string, re: RegExp }>} candidates
 * @returns {string|null} absolute path as the project sees it
 */
function reportFromTranscript(written, ctx, candidates) {
  if (!Array.isArray(written) || written.length === 0) return null;
  const root = real(ctx.root);
  const bkDir = path.join(root, 'bk') + path.sep;

  const hits = [];
  for (const w of written) {
    const abs = real(path.isAbsolute(w) ? w : path.join(ctx.root, w));
    if (!abs.startsWith(bkDir) || !abs.endsWith('.md')) continue;
    try { if (!fs.statSync(abs).isFile()) continue; } catch { continue; }
    hits.push(abs);
  }
  if (hits.length === 0) return null;

  const matchesContract = (abs) => candidates.some((c) =>
    path.dirname(abs) === real(c.absDir) && c.re.test(path.basename(abs)));
  const preferred = hits.filter(matchesContract);
  const pool = preferred.length ? preferred : hits;
  return pool[pool.length - 1];
}

/**
 * Resolve an agent's report.
 *
 * @param {string} agentType
 * @param {{ root: string, reportsDir: string, feature?: string|null, platform?: string|null, planDir?: string|null }} ctx
 * @param {number|null} startMs — when the agent started; null disables the freshness check
 * @param {string[]} [written] — files the agent wrote this run (agent-run-evidence
 *   filesWrittenBy); empty or absent falls back to the glob contract
 * @returns {{ status: 'none'|'unresolvable'|'found'|'missing'|'stale', path?: string, gated?: boolean, expected?: string[], via?: 'transcript'|'contract' }}
 *   none — the agent owes no report. unresolvable — it does, but workflow state does not say
 *   where, and the transcript shows no write either. found — a qualifying file. missing — no
 *   candidate exists. stale — candidates exist, none written during this run.
 */
function resolveReport(agentType, ctx, startMs, written) {
  const bare = String(agentType || '').replace(/^bk-/, '');
  if (!CONTRACTS[bare]) return { status: 'none' };

  const candidates = candidatesFor(agentType, ctx) || [];

  // Primary evidence: the agent wrote a bk/ document during this run. Checked before the
  // contract resolves, because a run with no feature in workflow state still wrote somewhere.
  const own = reportFromTranscript(written, ctx, candidates);
  if (own) {
    return { status: 'found', path: own, gated: isGatedReport(own, real(ctx.reportsDir)), via: 'transcript' };
  }

  if (candidates.length === 0) return { status: 'unresolvable' };

  const existing = [];
  for (const c of candidates) {
    let names = [];
    try { names = fs.readdirSync(c.absDir); } catch { continue; }
    for (const name of names) {
      if (!c.re.test(name)) continue;
      const abs = path.join(c.absDir, name);
      try {
        const st = fs.statSync(abs);
        if (st.isFile()) existing.push({ path: abs, mtimeMs: st.mtimeMs });
      } catch { /* vanished */ }
    }
  }

  const expected = candidates.map((c) => path.join(c.absDir, c.show));

  if (existing.length === 0) return { status: 'missing', expected };

  const fresh = Number.isFinite(startMs)
    ? existing.filter((e) => e.mtimeMs >= startMs - MTIME_TOLERANCE_MS)
    : existing;

  if (fresh.length === 0) {
    const newest = existing.sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
    return { status: 'stale', path: newest.path, expected };
  }

  const best = fresh.sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
  return { status: 'found', path: best.path, gated: isGatedReport(best.path, ctx.reportsDir), via: 'contract' };
}

module.exports = { resolveReport, candidatesFor, MTIME_TOLERANCE_MS };
