/**
 * workflow-summary.cjs — build and append one workflow-summary row for a (skill, feature).
 *
 * Extracted from workflow-metrics.cjs because a workflow needs closing out from more than one
 * place. The old hook emitted a summary only on the EDGE into a terminal phase, and
 * post-commit.cjs pins `current_phase: "commit"` with nothing moving it back out — so after a
 * feature's first commit every later SubagentStop exited at `already_summarized` and all
 * post-commit work went unsummarized. Field measurement (agents in agent-trace.jsonl vs
 * total_agents in workflow-summary.jsonl):
 *
 *   trustcall_ios  critical-security-fixes       11 agents -> summary said 3
 *   trustcall_ios  iap-purchase-flow              7 agents -> summary said 4
 *   trustcall_ios  crash-fixes-critical           7 agents -> summary said 6
 *   trustcall_ios  commonalertvc-keywindow-fix    2 agents -> summary said 1
 *   fusionworkomni (ad-hoc, skill/feature "unknown")  10 traced -> summary said 4
 *   plus 5 trustcall rows never covered by ANY summary
 *
 * insights.md read that back as "Avg 3.5 agents/workflow, health looks good" for a period that
 * really ran about 8 per workflow.
 *
 * The three callers are the terminal-phase edge (unchanged), a feature-change rollup, and the
 * Stop-event flush. They differ only in `closedBy`.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { appendJsonl } = require('./jsonl-rotator.cjs');
const { resolveWorkflowId } = require('./workflow-identity.cjs');

/** Read a JSONL file into parsed rows, skipping anything unparseable. [] if unreadable. */
function readRows(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

/**
 * Join trace rows to their measured durations.
 *
 * Duration is measured, not fabricated. This used to be `totalAgents * 120` — the agent count
 * times a constant, carrying no information `total_agents` right next to it does not already
 * carry. subagent-live-tracker writes one `stop` row per agent to subagent-live.jsonl with a
 * measured `duration_ms`, keyed by the same `stable_id` the trace rows carry (both are set
 * from `readStopIdentity(data).id`), so this is an exact join, not a heuristic.
 *
 * Field evidence (fusionworkomni, one day, 33 agents): all 33 trace rows matched a `stop`
 * event exactly on stable_id. Real elapsed was 5863s against the constant's 3960s —
 * understated by 48% — and the longest single agent ran 638s, the actionable number the
 * constant hid completely.
 *
 * Never falls back to a fabricated number: with nothing to measure the summary carries
 * total_duration_ms: null and duration_source 'unavailable'. Reads fail open.
 */
function measureDurations(metricsDir, entries) {
  const stopDurations = new Map();
  try {
    const livePath = path.join(metricsDir, 'subagent-live.jsonl');
    for (const line of fs.readFileSync(livePath, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let row;
      try { row = JSON.parse(line); } catch { continue; }
      if (!row || row.event !== 'stop' || !row.stable_id) continue;
      if (typeof row.duration_ms !== 'number' || !Number.isFinite(row.duration_ms)) continue;
      // First stop row wins, matching alreadyRecorded()'s first-record-wins rule.
      if (!stopDurations.has(row.stable_id)) stopDurations.set(row.stable_id, row.duration_ms);
    }
  } catch { /* missing or unreadable → duration_source stays 'unavailable' */ }

  let matched = 0;
  let totalMs = 0;
  let maxMs = 0;
  for (const e of entries) {
    const ms = e && e.stable_id ? stopDurations.get(e.stable_id) : undefined;
    if (typeof ms !== 'number') continue;
    matched++;
    totalMs += ms;
    if (ms > maxMs) maxMs = ms;
  }
  const source = matched === 0
    ? 'unavailable'
    : (matched === entries.length ? 'measured' : 'partial');
  return { matched, totalMs, maxMs, source, total: entries.length };
}

/**
 * fix_loops used to fire only when the agent NAME contained "fix" or `status` contained
 * "fix_loop". No bk-* agent is named "fix", and `status` was structurally "unknown" because
 * SubagentStop carries no such key — so `fix_loops: 0` in 8 of 8 field summary rows, including
 * a trustcall session with two visible developer->reviewer->developer cycles. A structural
 * zero, not a measured one. The agent-name guess is gone; rows written by older kit versions
 * have no `signals` array, so the legacy `status` check stays as an OR.
 *
 * The `fix_loop_stuck` signal alone was still a structural zero. X-Game-Pro on 0.12.1: 18 of
 * 18 summary rows read `fix_loops: 0`, while crypto-session-protocol's plan dir held
 * review-fix-batch-1.md and review-security-batch-2-fix.md and its trace showed
 * bk-code-reviewer -> bk-ios-developer twice. `fix_loop_stuck` only fires when an agent's final
 * message says it is stuck; an ordinary review -> fix cycle says nothing of the kind. And the
 * conductor sometimes fixes without moving current_phase back to "coding" (and when it does,
 * "coding" is also every batch's start), so phase history cannot show it either. What does show
 * it is the ORDER of agents in the trace — see countReviewFixCycles.
 */
function countFixLoops(entries) {
  const stuck = entries.filter((e) =>
    (Array.isArray(e.signals) && e.signals.includes('fix_loop_stuck')) ||
    (e.status || '').toLowerCase().includes('fix_loop')
  ).length;
  return stuck + countReviewFixCycles(entries);
}

/** Agents whose output is a verdict on code someone else wrote. */
const REVIEWER_AGENTS = new Set([
  'bk-code-reviewer', 'bk-security-auditor', 'bk-performance-analyzer', 'bk-gemini-reviewer'
]);

/** Agents that change code or tests — the ones a fix is dispatched to. */
function isImplementer(agent) {
  return /^bk-[a-z]+-developer$/.test(agent)
    || agent === 'bk-unit-test-agent'
    || agent === 'bk-debugger';
}

/**
 * Advisory agents are transparent: a reviewer's findings -> bk-brainstormer -> developer is
 * still that review's fix. Every OTHER agent (git-manager, project-manager, docs-writer,
 * planner, …) ends the cycle — work after a commit or a close-out is new work, not a fix.
 */
const ADVISORY_AGENTS = new Set([
  'bk-brainstormer', 'bk-researcher', 'bk-problem-solving', 'bk-sequential-thinking'
]);

/**
 * Phases in which an implementer can only be answering the review before it. bk-code writes
 * `current_phase: "coding"` before every batch's developers (batch-execution.md § FSM State
 * Per Batch), so an implementer still stamped "review"/"testing" was dispatched without a new
 * batch starting. An empty phase means no workflow state at all — no batches to confuse.
 * "coding" is not here: it counts only with a same-batch stamp — see answersReview.
 */
const FIX_PHASES = new Set(['review', 'testing', '']);

/**
 * Review -> fix cycles, read from the order agents finished in. One cycle = an implementer
 * (bk-*-developer, bk-unit-test-agent, bk-debugger) whose nearest preceding non-advisory agent
 * is a reviewer (bk-code-reviewer, bk-security-auditor, bk-performance-analyzer,
 * bk-gemini-reviewer), with both in the same (skill, feature) — `entries` is already scoped.
 * One review answered by several implementers (fix, then re-test) is ONE cycle.
 *
 * Deliberately conservative — it undercounts rather than invent loops:
 *   - The implementer must be in a FIX_PHASE, or in "coding" with the batch to disambiguate.
 *     "coding" alone is ambiguous: it is both the next batch's start and the documented
 *     loop-back, and a multi-batch plan runs reviewer -> next batch's developer once per batch
 *     boundary. X-Game-Pro's ios-project-init (3 batches, every review "approve", no fix files)
 *     would read 2 loops without this. A parked terminal phase ("commit" — tracking-background
 *     sat there all run) is ambiguous the same way, and its reviewer -> developer at
 *     07:15 -> 07:20 was batch 2 starting.
 *   - When both rows carry a `batch` number and they differ, it is batch progress, whatever
 *     the phase says.
 *   - When both rows carry a `batch` number and it is the SAME batch, a "coding" implementer is
 *     the loop-back, not a batch start. 0.12.2 left "coding" out entirely, which missed the
 *     main fix path: batch-execution.md § FSM State Per Batch documents "review fix loop →
 *     coding". X-Game-Pro on 0.12.3, quick-session-create: security-auditor + code-reviewer
 *     (review, batch 2) -> bk-unit-test-agent (coding, batch 2, "Fix loop hoàn tất") ->
 *     bk-ios-developer (coding, batch 3) — the summary read fix_loops 0 for a real loop. A
 *     batch start cannot look like this: the boundary write is `batch: N+1` together with the
 *     recurrence reset (workflow-state.md), so the next batch's developer carries N+1. The
 *     remaining risk is a conductor that never advances `batch` — every boundary would then
 *     read as a loop — but that conductor also trips the phase-recurrence block on its third
 *     `coding`, so it does not get far. Rows without a batch on either side (pre-0.12.2 traces,
 *     workflows the conductor never stamped) keep the old rule: "coding" is not counted.
 *   - A reviewer followed by bk-planner (bk-plan's critic pass) is not a code fix: the planner
 *     is not an implementer, so it ends the cycle uncounted.
 *   - Test-failure fixes (bk-unit-test-agent -> bk-debugger -> re-test) are not counted: a
 *     test agent reporting failures is not distinguishable in the trace from one passing.
 *
 * Rows are ordered by `ts`, which is when each agent FINISHED (SubagentStop), not when it was
 * dispatched — sequential dispatches finish in dispatch order, so that is the same thing for
 * the review -> fix sequence this reads. The sort is stable, so equal timestamps keep file
 * order. Against the X-Game-Pro trace this reads crypto-session-protocol 2, device-identity-
 * auth 1, every other feature 0 — and the spawn descriptions in subagent-live.jsonl agree on
 * all three: "Fix flaky sleep in KeywrapElectionTests" and "Fix security audit medium findings
 * batch 2" right after a review, "Fix B1 test warnings" right after one, and ios-project-init's
 * two reviewer -> developer boundaries were "Implement … batch N". Known misses, both on the
 * conservative side: tracking-background's "Fix flaky tracking tests" after its batch-1 review
 * (FSM parked at "commit", a bug fixed in 0.11.1), and fixes dispatched after the close-out
 * agents (project-manager / git-manager) had already run.
 */
function countReviewFixCycles(entries) {
  const ordered = entries
    .map((e, i) => ({ e, i, t: Date.parse(e && e.ts) || 0 }))
    .sort((a, b) => (a.t - b.t) || (a.i - b.i))
    .map((x) => x.e);

  let cycles = 0;
  let pendingReview = null;
  for (const e of ordered) {
    const agent = String((e && e.agent) || '');
    if (REVIEWER_AGENTS.has(agent)) { pendingReview = e; continue; }
    if (ADVISORY_AGENTS.has(agent)) continue;
    if (pendingReview && isImplementer(agent) && answersReview(pendingReview, e)) cycles++;
    pendingReview = null;
  }
  return cycles;
}

/**
 * True when `impl` is a fix for `review` rather than the next batch starting. The batch is only
 * trusted when BOTH rows carry one; a single-sided stamp falls back to the phase rule.
 */
function answersReview(review, impl) {
  const phase = String(impl.phase || '');
  if (Number.isInteger(review.batch) && Number.isInteger(impl.batch)) {
    if (review.batch !== impl.batch) return false;
    // Same batch: "coding" is the documented review -> fix loop-back, not a batch start.
    if (phase === 'coding') return true;
  }
  return FIX_PHASES.has(phase);
}

/**
 * Any signal at all counts as reactive. The agent-name check stays as an OR: dispatching
 * bk-brainstormer / bk-problem-solving / bk-sequential-thinking IS a reactive signal by
 * design, and pre-upgrade rows carry no `signals` array to read.
 */
function countReactiveSignals(entries) {
  return entries.filter((e) => {
    if (Array.isArray(e.signals) && e.signals.length > 0) return true;
    const agent = (e.agent || '').toLowerCase();
    return agent.includes('brainstorm')
      || agent.includes('problem-solving')
      || agent.includes('sequential-thinking');
  }).length;
}

/**
 * Close out a (skill, feature) and append one row to workflow-summary.jsonl.
 *
 * @param {object} opts
 * @param {string} opts.metricsDir      — the project's .bk-metrics directory
 * @param {string} opts.skill
 * @param {string} opts.feature
 * @param {string} opts.phase           — phase recorded on the summary row
 * @param {string} opts.complexityTier
 * @param {'terminal-entry'|'feature-change'|'session-stop'} opts.closedBy
 * @param {string|null} [opts.sessionId] — the session doing the close-out; scopes ad-hoc work
 * @returns {object|null} the summary written, or null when there was nothing to summarize
 */
function emitSummary({ metricsDir, skill, feature, phase, complexityTier, closedBy, sessionId }) {
  const summaryPath = path.join(metricsDir, 'workflow-summary.jsonl');
  const tracePath = path.join(metricsDir, 'agent-trace.jsonl');

  // WHICH WORKFLOW THIS ROW BELONGS TO, stamped rather than inferred by the readers.
  //
  // 0.10.1 made `bk metrics` and pattern-extractor group summary rows by (skill, feature),
  // because one workflow legitimately closes out more than once. But ad-hoc sessions (no /bk-*
  // skill) all write skill and feature "unknown", so under that key EVERY ad-hoc session ever
  // run collapsed into one workflow: fusionworkomni's insights.md read "Based on last 1
  // workflow(s) across 6 summary row(s) … Avg 14.0 agents/workflow" for six rows written by
  // several separate sessions. Rows carried no session or workflow id, so the readers had
  // nothing better to key on.
  //
  // resolveWorkflowId is the kit's one definition of "this workflow" (the cost ledger and
  // budget-guard use it too). A skill workflow keys on command:feature — `bk-code:crypto-module`
  // — so it still merges across sessions, which is the 0.10.1 intent (a resumed feature is the
  // same workflow). Work with no feature falls back to the session id — `session:<id>` for an
  // ad-hoc run — so each ad-hoc session is its own workflow.
  //
  // The callers hand over the trace rows' view of skill/feature, where a missing value is
  // already the literal "unknown". Mapped back to absent here, otherwise the ad-hoc id would be
  // `unknown:unknown` — the exact collapse this exists to undo.
  const knownSkill = skill && skill !== 'unknown' ? skill : '';
  const knownFeature = feature && feature !== 'unknown' ? feature : '';
  const sid = typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : '';
  const workflowId = resolveWorkflowId({ command: knownSkill, feature: knownFeature }, sid || null);

  // A workflow with no feature IS the session, so its agents are this session's agents only.
  // agent-trace.jsonl is shared by every session in the repo (see the feature-change gate in
  // workflow-metrics.cjs), and two concurrent ad-hoc sessions both trace skill/feature
  // "unknown" — without this filter, a row stamped `session:A` would count session B's agents
  // and the id would be a lie. Without a session id there is nothing to scope by, and the old
  // (skill, feature) behaviour stands.
  const sessionScoped = !knownFeature && Boolean(sid);

  // Agents dispatched for THIS workflow — those traced since the previous summary for the
  // same feature and skill.
  //
  // It used to count every trace row the feature had ever produced, so the number grew by one
  // per workflow and was reported as that workflow's own. Six commits on one feature filed
  // total_agents 101..106, and insights.md read that back as "Avg 103.5 agents/workflow" for a
  // feature that dispatched about 8. This `since` cut is also what makes repeat summaries for
  // one feature safe, which is what the feature-change and session-stop close-outs rely on.
  //
  // For a session-scoped workflow the `since` cut must also be per session: session A closing
  // at T would otherwise hide every row concurrent session B traced before T. A prior row with
  // no workflow_id (written before this field existed) still counts as a cut, so a session that
  // spans the upgrade does not re-count what the legacy row already covered.
  const priorSummaries = readRows(summaryPath)
    .filter((e) => e.feature === feature && e.skill === skill && e.ts)
    .filter((e) => !sessionScoped || !e.workflow_id || e.workflow_id === workflowId);
  const since = priorSummaries.length
    ? Date.parse(priorSummaries[priorSummaries.length - 1].ts)
    : 0;

  const featureEntries = readRows(tracePath)
    .filter((e) => e.feature === feature && e.skill === skill)
    .filter((e) => !sessionScoped || e.session_id === sid)
    .filter((e) => !since || (Date.parse(e.ts) || 0) > since);

  // A rollup with total_agents 0 is noise — the previous close-out already covered these rows.
  if (featureEntries.length === 0) return null;

  const dur = measureDurations(metricsDir, featureEntries);

  const summary = {
    ts: new Date().toISOString(),
    skill,
    feature,
    // The grouping key for readers (see above). session_id is the session that did the
    // close-out — for a skill workflow that spans sessions it names only the last of them.
    workflow_id: workflowId,
    session_id: sid || null,
    phase,
    complexity_tier: complexityTier,
    total_agents: featureEntries.length,
    total_duration_ms: dur.matched ? Math.round(dur.totalMs) : null,
    max_agent_duration_ms: dur.matched ? Math.round(dur.maxMs) : null,
    duration_source: dur.source,
    // On a partial match the shortfall must be legible, not silently folded into a
    // smaller total.
    ...(dur.source === 'partial'
      ? { duration_matched: dur.matched, duration_total: dur.total }
      : {}),
    fix_loops: countFixLoops(featureEntries),
    reactive_signals: countReactiveSignals(featureEntries),
    // Which close-out wrote this row. Reading a run's summaries without it cannot tell a
    // workflow that ended at a commit from one the session flush had to close.
    closed_by: closedBy
  };

  appendJsonl(summaryPath, JSON.stringify(summary) + '\n');

  // Serena sync (optional — only if BK_SERENA_AVAILABLE=true). Write a flag file; the actual
  // Serena write_memory happens in conductor context, not in a hook.
  if (process.env.BK_SERENA_AVAILABLE === 'true') {
    try {
      fs.writeFileSync(
        path.join(metricsDir, 'serena-sync-pending.json'),
        JSON.stringify({
          ts: new Date().toISOString(), skill, feature, summary_ref: summaryPath, pending: true
        }, null, 2),
        'utf8'
      );
    } catch { /* best-effort flag file */ }
  }

  return summary;
}

module.exports = { emitSummary, countFixLoops, countReviewFixCycles };
