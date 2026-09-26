# Workflow State (FSM) — bk-code

Two state files exist and they are NOT interchangeable. Both must be written.

| File | Owner | Scope | Purpose |
|------|-------|-------|---------|
| `{plan-dir}/.plan-state.json` | bk-code | Per feature | Batch/sub-task progress, step results, agent trace, crash recovery |
| `bk/dev/shared/.workflow-state.json` | bk-code | Per workflow | FSM phase. Read by `fsm-guard.cjs`, `compact-recovery.cjs`, `statusline.cjs`, `handoff-writer.cjs` |

Writing only `.plan-state.json` leaves the FSM inert: `fsm-guard` never fires, so the
phase-recurrence ladder (warn → block → halt) and the escalation path never run, and after
a compaction `compact-recovery` restores nothing. Both writes, every transition.

## Fields bk-code owns

```json
{
  "workflow_type": "bk-code",
  "command": "bk-code",
  "feature": "{feature-slug}",
  "current_phase": "plan|coding|testing|review|commit|escalated|aborted",
  "plan_dir": "bk/dev/{feature}",
  "batch": 1,
  "total_batches": 4,
  "complexity_tier": "Trivial|Standard|Complex",
  "review_mode": "auto|review|quick",
  "platform": "ios|android|flutter",
  "quality_fix_count": 0,
  "build_retry_count": 0,
  "test_fix_count": 0,
  "skills_loaded": [],
  "dev_agent_id": null,
  "reviewer_agent_id": null
}
```

`workflow_type` (or `command`) is what `fsm-guard` matches against its transition table.
Omit it and the guard passes everything through silently — the state file looks healthy
while enforcing nothing.

`phase_history[]` and `phase_recurrence_count{}` are appended by `fsm-guard` itself on every
accepted transition, right after your write lands (the guard never changes the file before the
write, so a Read → Write pair is not invalidated by it). A refused transition is not recorded.
Do not hand-maintain them; read them. `fsm-guard` **refuses** any Write/Edit that changes
`phase_history`, changes `phase_recurrence_count` other than resetting it to `{}`, or sets
`recurrence_reset_ts` — copy them unchanged or leave them out (a Write that leaves them out
gets them restored). To move the workflow, change `current_phase` and nothing of the guard's.

## When to write

| Workflow point | `current_phase` | Also write |
|----------------|-----------------|-----------|
| Code-Step-1, after plan.md parsed | `plan` | `workflow_type`, `feature`, `plan_dir`, `platform`, `complexity_tier`, `total_batches` |
| Code-Step-3a, first dispatch of a batch | `coding` | `batch`, `dev_agent_id` |
| Code-Step-3b, before test dispatch | `testing` | — |
| Code-Step-3c, before review dispatch | `review` | `reviewer_agent_id` |
| Code-Step-3c, critical findings → re-implement | `coding` | `quality_fix_count += 1` |
| Code-Step-3d, batch complete → next batch | *(unchanged)* | `batch += 1`, `phase_recurrence_count: {}` |
| Code-Step-4, before bk-git-manager | `commit` | — |
| Fix loop / build retry limit exceeded | `escalated` | reason + options presented to user |

Valid transitions (enforced by `fsm-guard`):
`(none)→plan→coding→testing→review→{coding|commit|escalated}`, `escalated→{coding|commit|aborted}`.
Anything else is refused with exit 2 — that refusal is the guard working, not a bug to route around.

## Starting the next feature

`commit` and `aborted` end the episode, they do not end the repo. Code-Step-1 of the *next*
feature writes `current_phase: "plan"` over the terminal state (or over the `/bk-plan` that
produced this plan — `completed`, or still `planning` if its approval write was missed): the guard reads that as a new
episode, allows it, and — once the write has landed — resets `phase_history[]` /
`phase_recurrence_count{}` so the last feature's fix loops cannot block this one. It also bumps
`workflow_episode` and stores the finished workflow under `previous_episode`. Those fields are
overwritten even if your write copied the old values; everything else you wrote is kept.

Write the opening phase — never delete `.workflow-state.json` to escape a terminal state.

## Batch boundary reset (important)

The recurrence ladder counts how many times a phase is entered — from `phase_recurrence_count`
and from the last 5 `phase_history` entries. A 4-batch plan legitimately enters `coding` four
times, which would trip the block at 3. So on **successful batch completion only**, reset the
counter in the **same write** that advances the batch:

```
Write bk/dev/shared/.workflow-state.json:
  { ...state, "batch": N+1, "phase_recurrence_count": {} }
```

Leave `current_phase` unchanged in that write — it is not a transition. When a write both
advances `batch` and resets the counter, the guard also stamps `recurrence_reset_ts` after it
lands, and the history window only counts entries after that instant — so the next
`review → coding` starts from zero on both halves. A reset *without* `batch: N+1` clears the
count only; the window still sees the loop.

Never reset the counter to escape a fix loop. Progress between batches earns the reset;
re-entering the same batch does not.

## Sync rule

Every transition writes BOTH files in the same step:

1. `bk/dev/shared/.workflow-state.json` → new `current_phase` (+ counters above)
2. `{plan-dir}/.plan-state.json` → `currentStep`, `completedSteps`, `stepResults`

If the two disagree on resume, `.plan-state.json` is authoritative for *what work is done*
and `.workflow-state.json` is authoritative for *which phase the workflow is in*. Reconcile
by re-deriving the phase from the last completed sub-task, then writing both.

## Statusline progress

While `/bk-code` runs a plan, the statusline shows a line of its own, under the
platform/workflow line: `📋 sub 3/7 ✗1 ⏸1 · task 12/30 ✗2 · B2/4` (done/total, ✗ failed,
⏸ blocked, current batch). Other workflows — including `/bk-plan` — never show it. It reads
`plan_dir` from `.workflow-state.json`, then the plan on disk — not Claude Tasks — so it is
only as current as the Post Sub-Task Sync.

A sub-task's status is taken from any of: its frontmatter `status:`, `.plan-state.json`
`stepResults[NN].status`, or its row's Status in a plan.md table. Done in any source wins,
then failed, then blocked.

| Counted as | Status word (frontmatter, stepResults, or plan.md Status cell) |
|------------|--------------------|
| Sub-task done | `complete` / `completed` / `done` |
| Sub-task failed ✗ | `failed` / `escalated` / `error` — it was attempted and did not work |
| Sub-task blocked ⏸ | `blocked` / `needs_info` — waiting on a decision or another sub-task |
| Task done | `- [x]` under `## Tasks` |
| Task failed | an unchecked `## Tasks` item in a failed sub-task |

Keep failed and blocked apart: a sub-task waiting on a design answer has not failed.
A sub-task that hits a retry limit is written `failed` *before* escalating; when the user's
choice resolves it, set it back to `in-progress` or `complete`.

The task counter is hidden unless every sub-task file has a `## Tasks` section (pre-0.6.0
plans have none). `aborted` hides the whole line. Code: `hooks/lib/workflow-progress.cjs`,
`hooks/lib/plan-table-status.cjs`.

## Resume after compaction

1. Read `.workflow-state.json` → `current_phase`, `batch`, fix-loop counters
2. Read `{plan-dir}/.plan-state.json` → `completedSteps`, `stepResults`
3. Resume at `current_phase` for `batch` — do not re-execute completed phases
4. Check `quality_fix_count` / `build_retry_count` before re-entering `coding`
5. Verify the artifacts the phase requires exist before proceeding
6. If `workflow_paused: true` — the recurrence hard block fired. Do NOT continue; use
   AskUserQuestion with the options in the block message. Resuming needs the user to run
   `node .claude/cli/bk-health/index.cjs --resume --force`, which clears the pause and resets
   the ladder (count + history window). Never edit the state file to get past it.
