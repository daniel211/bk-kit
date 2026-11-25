# Workflow State (FSM) — bk-plan

`bk/dev/shared/.workflow-state.json` holds ONE workflow: whichever wrote it last. If bk-plan
does not declare itself there, the plan run inherits the previous workflow — a finished
`/bk-code` stays at `bk-code / commit`, the planning agents are traced and summarized as that
workflow, and statusline / compact-recovery show the wrong one. `.plan-state.json` tracks the
plan's steps; this file only says "a plan for {feature} is in flight". Both are written.

## Opening the workflow — one CLI call

```
node .claude/cli/bk-health/index.cjs --start bk-plan --feature <slug> [--platform ios|android|flutter] [--plan-dir <dir>]
```

It writes `workflow_type`/`command: "bk-plan"`, `feature`, `workflowId`, `plan_dir` (default
`bk/dev/<slug>`), `platform` (kept if omitted), `current_phase: "planning"`, opens a new episode
(fresh `phase_history` / counts, `previous_episode`), and clears the last workflow's per-workflow
fields (`batch`, `total_batches`, `completed_batches`, `complexity_tier`, fix budgets,
`signal_count` / `retry_agents` / `last_signal`, agent ids, testing evidence). Cost tally, dispatch
counts and halt flags are kept. Never write `.workflow-state.json` through Bash/python heredocs —
`fsm-guard` never sees those writes.

## When to write

| Workflow point | `current_phase` | Also write |
|----------------|-----------------|-----------|
| Step 2, once the feature slug is known | `planning` | `--start bk-plan` (above) |
| Step 12, user approves | `completed` | — (then output `/bk-code {plan-dir}/plan.md`) |
| Step 12, user cancels | `aborted` | — |
| Step 12, user asks for revisions | *(unchanged)* | — |
| `--archive` mode | *(no write)* | archive touches no workflow |

Transitions (enforced by `fsm-guard`): `(none)→planning→{completed|aborted}`. Step 12's writes are
`node .claude/cli/bk-health/index.cjs --set-phase completed|aborted` — the same validation as an Edit, without
reading the state file first.

## Handoffs

- **Over a finished workflow** (`commit` / `aborted` / `completed`, any feature): `--start`
  opens a new episode; the old one lands in `previous_episode`.
- **To /bk-code**: Code-Step-1's `--start bk-code` opens over `completed` — or over a `planning`
  the approval write never reached, so a missed `completed` never blocks the hand-off.
- **Over an in-flight bk-code/bk-debug/bk-refactor** (non-terminal phase): `--start` refuses
  with exit 2. That workflow still owns the file — do not route around it. AskUserQuestion:
  finish or abort that workflow first (`--force` only on the user's word: its work stays
  uncommitted), or plan without the state write (say the statusline and metrics will show the
  other workflow until it ends).

## Resume after compaction

`current_phase: "planning"` → resume from `.plan-state.json` `currentStep`
(`handoff-protocol.md`). Do not re-write `planning`; it is already set.
