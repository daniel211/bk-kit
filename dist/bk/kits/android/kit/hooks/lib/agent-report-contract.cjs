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
 * Freshness: when the agent's start time is known (the first line of its transcript, see
 * lib/agent-run-evidence.cjs) a candidate only counts if it was modified during the run. A
 * report left by a previous dispatch is exactly what a re-dispatched agent that did nothing
 * would otherwise be credited with. Without a start time the check degrades to existence,
 * which is what it always was.
 *
 * Known weakness, stated plainly: researchers run in parallel and share one glob
 * (`researcher-*.md`), so a researcher that wrote nothing is credited if a sibling wrote its
 * file during the same window. Telling them apart would need the per-dispatch path from the
 * prompt, which the hook does not see.
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
 * Per agent (bk- prefix stripped): candidate locations as { dir, show, re, why } — `show` is
 * the name as a person reads it in a rejection message, `re` the exact match. `dir` is one of
 * 'reports' (bk/dev/shared/reports), 'planResearch' ({plan_dir}/research), 'plan'
 * ({plan_dir}), 'featureDir' (bk/dev/{feature}) or 'devResearch' (bk/dev/research). A
 * candidate whose directory cannot be resolved from workflow state is dropped; if all are
 * dropped the contract is unresolvable and nothing is checked.
 *
 * `-batch\d+` is accepted on every shared/reports name: bk-code reviews per batch, and the
 * field reviewer wrote code-review-ios-project-init-batch1.md … batch3.md.
 */
const CONTRACTS = {
  'code-reviewer': ({ f, F }) => [
    { dir: 'reports', show: `code-review-${F}[-batchN].md`, re: new RegExp(`^code-review-${f}(?:-batch\\d+)?\\.md$`), why: 'agents/bk-code-reviewer.md' },
    { dir: 'planResearch', show: 'review-batch-N.md', re: /^review-batch-\d+(?:-retry)?\.md$/, why: 'bk-code batch-execution.md' }
  ],
  'gemini-reviewer': ({ f, F }) => [
    { dir: 'reports', show: `code-review-gemini-${F}[-batchN].md`, re: new RegExp(`^code-review-gemini-${f}(?:-batch\\d+)?\\.md$`), why: 'agents/bk-gemini-reviewer.md' }
  ],
  'security-auditor': ({ f, F }) => [
    { dir: 'reports', show: `security-${F}[-batchN].md`, re: new RegExp(`^security-${f}(?:-batch\\d+)?\\.md$`), why: 'agents/bk-security-auditor.md' },
    { dir: 'planResearch', show: 'review-security-batch-N.md', re: /^review-security-batch-\d+\.md$/, why: 'bk-code batch-execution.md' }
  ],
  'performance-analyzer': ({ f, F }) => [
    { dir: 'reports', show: `performance-${F}[-batchN].md`, re: new RegExp(`^performance-${f}(?:-batch\\d+)?\\.md$`), why: 'agents/bk-performance-analyzer.md' }
  ],
  'unit-test-agent': ({ f, F, p, P }) => [
    { dir: 'reports', show: `unit-test-${P}-${F}[-batchN].md`, re: new RegExp(`^unit-test-${p}-${f}(?:-batch\\d+)?\\.md$`), why: 'agents/bk-unit-test-agent.md' },
    { dir: 'planResearch', show: 'test-batch-N*.md', re: /^test-batch-\d+(?:-[\w-]+)?\.md$/, why: 'bk-code batch-execution.md' },
    // Not in any kit document — what the X-Game-Pro conductor asked for, and got, three times
    // (bk/dev/ios-project-init/research/unit-test-batch{1,2,3}.md). Rejecting the report an
    // agent was actually told to write is the bug this file exists to fix.
    { dir: 'planResearch', show: 'unit-test-batchN.md', re: /^unit-test-batch\d+\.md$/, why: 'observed in the field' }
  ],
  'device-test-agent': ({ f, F, p, P }) => [
    { dir: 'reports', show: `device-test-${P}-${F}[-batchN].md`, re: new RegExp(`^device-test-${p}-${f}(?:-batch\\d+)?\\.md$`), why: 'agents/bk-device-test-agent.md' }
  ],
  'test-architect': ({ f, F }) => [
    { dir: 'reports', show: `test-strategy-${F}.md`, re: new RegExp(`^test-strategy-${f}\\.md$`), why: 'agents/bk-test-architect.md' }
  ],
  'brainstormer': ({ f, F }) => [
    { dir: 'reports', show: `brainstorm-${F}.md`, re: new RegExp(`^brainstorm-${f}\\.md$`), why: 'agents/bk-brainstormer.md' }
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

/**
 * Resolve an agent's report.
 *
 * @param {string} agentType
 * @param {{ root: string, reportsDir: string, feature?: string|null, platform?: string|null, planDir?: string|null }} ctx
 * @param {number|null} startMs — when the agent started; null disables the freshness check
 * @returns {{ status: 'none'|'unresolvable'|'found'|'missing'|'stale', path?: string, gated?: boolean, expected?: string[] }}
 *   none — the agent owes no report. unresolvable — it does, but workflow state does not say
 *   where. found — a qualifying file. missing — no candidate exists. stale — candidates exist,
 *   none written during this run.
 */
function resolveReport(agentType, ctx, startMs) {
  const bare = String(agentType || '').replace(/^bk-/, '');
  if (!CONTRACTS[bare]) return { status: 'none' };

  const candidates = candidatesFor(agentType, ctx);
  if (!candidates || candidates.length === 0) return { status: 'unresolvable' };

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
  return { status: 'found', path: best.path, gated: isGatedReport(best.path, ctx.reportsDir) };
}

module.exports = { resolveReport, candidatesFor, MTIME_TOLERANCE_MS };
