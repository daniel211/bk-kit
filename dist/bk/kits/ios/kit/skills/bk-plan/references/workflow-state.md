# Workflow State (FSM) — bk-plan

`bk/dev/shared/.workflow-state.json` holds ONE workflow: whichever wrote it last. If bk-plan
does not declare itself there, the plan run inherits the previous workflow — a finished
`/bk-code` stays at `bk-code / commit`, the planning agents are traced and summarized as that
workflow, and statusline / compact-recovery show the wrong one. `.plan-state.json` tracks the
plan's steps; this file only says "a plan for {feature} is in flight". Both are written.

## Fields bk-plan owns

```json
{
  "workflow_type": "bk-plan",
  "command": "bk-plan",
  "feature": "{feature-slug}",
  "plan_dir": "bk/dev/{feature-slug}",
  "platform": "ios|android|flutter",
  "current_phase": "planning|completed|aborted",
  "batch": null,
  "total_batches": null,
  "complexity_tier": null
}
```

Read the file first and keep every field you do not own — cost tally, dispatch counts,
signals and halt flags belong to hooks. Null the previous workflow's per-feature fields
(`batch`, `total_batches`, `complexity_tier`) so they are not read as this plan's.
`phase_history[]` / `phase_recurrence_count{}` are the guard's — never hand-write them.

## When to write

| Workflow point | `current_phase` | Also write |
|----------------|-----------------|-----------|
| Step 2, once the feature slug is known | `planning` | every field above |
| Step 12, user approves | `completed` | — (then output `/bk-code {plan-dir}/plan.md`) |
| Step 12, user cancels | `aborted` | — |
| Step 12, user asks for revisions | *(unchanged)* | — |
| `--archive` mode | *(no write)* | archive touches no workflow |

Transitions (enforced by `fsm-guard`): `(none)→planning→{completed|aborted}`. Step 12's writes are
`node .claude/cli/bk-health/index.cjs --set-phase completed|aborted` — the same validation as an Edit, without
reading the state file first; the Step 2 declaration stays a full Write.

## Handoffs

- **Over a finished workflow** (`commit` / `aborted` / `completed`, any feature): writing
  `planning` opens a new episode — allowed, counters reset, the old one lands in
  `previous_episode`.
- **To /bk-code**: bk-code's Code-Step-1 writes `plan` over `completed` — a new episode. It is
  also accepted over a `planning` the approval write never reached, so a missed `completed`
  never blocks the hand-off.
- **Over an in-flight bk-code/bk-debug/bk-refactor** (non-terminal phase): the guard refuses
  with exit 2. That workflow still owns the file — do not route around it. AskUserQuestion:
  finish or abort that workflow first, or plan without the state write (say the statusline
  and metrics will show the other workflow until it ends).

## Resume after compaction

`current_phase: "planning"` → resume from `.plan-state.json` `currentStep`
(`handoff-protocol.md`). Do not re-write `planning`; it is already set.
