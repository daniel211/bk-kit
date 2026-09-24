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
write, so a Read → Write pair is not invalidated by it). Do not hand-maintain them; read them.

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

The recurrence ladder counts how many times a phase is entered. A 4-batch plan legitimately
enters `coding` four times, which would trip the block at 3. So on **successful batch
completion only**, reset the counter in the same write that advances the batch:

```
Write bk/dev/shared/.workflow-state.json:
  { ...state, "batch": N+1, "phase_recurrence_count": {} }
```

Leave `current_phase` unchanged in that write — the guard skips writes that do not change the
phase, so the reset lands untouched and the next `review → coding` starts from zero.

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
platform/workflow line: `📋 sub 3/7 ✗1 · task 12/30 ✗2 · B2/4` (done/total, ✗ = failed,
current batch). Other workflows — including `/bk-plan` — never show it. It reads `plan_dir`
from `.workflow-state.json`, then the plan on disk — not Claude Tasks — so it is only as
current as the Post Sub-Task Sync:

| Counted as | Written by bk-code |
|------------|--------------------|
| Sub-task done | frontmatter `status: complete` (or `stepResults[NN].status: "complete"`) |
| Sub-task failed | frontmatter `status: blocked` / `failed` (or `stepResults[NN].status: "failed"`) |
| Task done | `- [x]` under `## Tasks` |
| Task failed | an unchecked `## Tasks` item in a failed sub-task |

A sub-task that hits a retry limit and escalates is written as failed *before* asking the
user; when the user's choice resolves it, set it back to `in-progress` or `complete`.
`aborted` hides the counter. Code: `hooks/lib/workflow-progress.cjs`.

## Resume after compaction

1. Read `.workflow-state.json` → `current_phase`, `batch`, fix-loop counters
2. Read `{plan-dir}/.plan-state.json` → `completedSteps`, `stepResults`
3. Resume at `current_phase` for `batch` — do not re-execute completed phases
4. Check `quality_fix_count` / `build_retry_count` before re-entering `coding`
5. Verify the artifacts the phase requires exist before proceeding
6. If `workflow_paused: true` — the recurrence hard block fired. Do NOT continue; use
   AskUserQuestion with the options in the block message.
