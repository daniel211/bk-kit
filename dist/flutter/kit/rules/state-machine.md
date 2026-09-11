---
paths:
  - bk/dev/shared/.workflow-state.json
  - bk/dev/**
---

# Workflow State Machine

> Enforces valid phase transitions for FSM commands. Prevents phase-skipping after compaction.

---

## `/bk-code` Transitions

```
(none) → plan → coding → testing → review → [fix-loop max 2] → commit
                  ↑                   ↓
                  └── review ─────────┘ (fix loop)
```

| From | To | Required Artifact |
|------|----|-------------------|
| (none) | plan | — |
| plan | coding | Plan approved, skills loaded |
| coding | testing | Impl report exists for every sub-task in the batch |
| testing | review | Test agents complete |
| review | commit | All post-tasks complete |
| review | coding | Fix loop: `quality_fix_count < 2` AND critical/major findings |

### Complexity Routing

| Tier | Pipeline | Post-tasks |
|------|----------|-----------|
| Trivial | plan → code → commit | None |
| Standard | Full pipeline | bk-code-reviewer + bk-unit-test-agent |
| Complex | Full pipeline | bk-code-reviewer + bk-security-auditor + bk-performance-analyzer + bk-unit-test-agent + bk-device-test-agent |

---

## `/bk-debug` Transitions

```
(none) → classify → [analyze] → [brainstorm] → code → test → [review] → commit
              ↓                                   ↑
          code → commit  (Trivial shortcut)      |
                                                  |
              analyze → brainstorm (Complex only)─┘
```

| From | To | Required Artifact | Condition |
|------|----|-------------------|-----------|
| (none) | classify | — | — |
| classify | analyze | — | Complexity: Standard/Complex |
| classify | code | — | Complexity: Trivial (skip analyze) |
| analyze | code | Root cause identified | Complexity: Standard |
| analyze | brainstorm | Root cause identified | Complexity: Complex |
| brainstorm | code | Brainstorm + research reports | Complexity: Complex |
| code | test | Fix applied, `impl-{feature}-debug.md` exists | — |
| test | review | Test agents complete | Standard/Complex |
| test | commit | — | Trivial — skip review |
| review | commit | Post-tasks complete | — |
| review | code | Critical findings | Fix loop: mode-aware max cycles |

### Review Mode Fix Loop Limits

| Mode | Max Cycles | Auto-approve Threshold |
|------|------------|----------------------|
| `--auto` | 2 | score >= 9.5, critical == 0 |
| `--review` | 2 | Never (always ask user) |
| `--quick` | 1 | score >= 8.5, critical == 0 |

---

## `/bk-refactor` Transitions

```
(none) → analyze → refactor → test → [fix-loop max 1] → commit
                     ↑                      ↓
                     └── test ──────────────┘ (1 retry only)
```

| From | To | Required Artifact |
|------|----|-------------------|
| (none) | analyze | — |
| analyze | refactor | Refactoring scope identified |
| refactor | test | `impl-{feature}-refactor.md` exists |
| test | commit | Tests pass |
| test | refactor | Fix loop: `refactor_fix_count < 1` AND tests fail |

Fix-loop max 1: 1 automatic retry, then escalate to user.

---

## State Persistence

File: `bk/dev/shared/.workflow-state.json`

Written by the FSM commands (`/bk-code`, `/bk-debug`, `/bk-refactor`) at **every** phase
change. `fsm-guard.cjs` fires on Write/Edit of this path — a command that tracks its progress
only in a per-feature state file (`.plan-state.json`, `.spec-state.json`) gets no transition
validation, no recurrence ladder and no compaction recovery.

`workflow_type` (alias: `command`) is what the guard matches against the transition tables
below. Without it every transition passes through unvalidated.

```json
{
  "workflow_type": "bk-code|bk-debug|bk-refactor",
  "command": "bk-code|bk-debug|bk-refactor",
  "feature": "feature-name-slug",
  "current_phase": "plan|coding|testing|review|commit|escalated|aborted|classify|analyze|brainstorm",
  "phase_history": [{"phase": "", "from_phase": "", "ts": 0, "entered_by": ""}],
  "phase_recurrence_count": {},
  "batch": 1,
  "quality_fix_count": 0,
  "build_retry_count": 0,
  "test_fix_count": 0,
  "refactor_fix_count": 0,
  "complexity_tier": "Trivial|Standard|Complex",
  "issue_type": "general|build|crash|device|perf",
  "review_mode": "auto|review|quick",
  "dev_agent_id": null,
  "reviewer_agent_id": null,
  "brainstorm_complete": false,
  "research_complete": false,
  "skills_loaded": [],
  "platform": "ios|android|flutter",
  "fix_guidance": null
}
```

---

## Terminal & Error States

| State | Type | Description |
|-------|------|-------------|
| `commit` | Terminal (success) | Feature committed successfully |
| `escalated` | Terminal (pending) | Fix-loop max exceeded — awaiting user decision |
| `aborted` | Terminal (failure) | User chose to discard work |

### Halt flags (set by the harness, cleared only by the user)

| Field | Set by | Meaning |
|-------|--------|---------|
| `global_halt` | `global-kill-switch.cjs` | Repeated red signals — every guarded tool call is refused |
| `halt_reasons[]` | `global-kill-switch.cjs` | Which signals tripped it |
| `halt_override_consumed` | `global-kill-switch.cjs` | The one-shot `BK_HARNESS_OVERRIDE=1` has been spent |
| `workflow_paused` | `fsm-guard.cjs` | Phase-recurrence hard block — do NOT continue, ask the user |

None of these clear themselves, and no new session resets them. The user clears them with
`node .claude/cli/bk-health/index.cjs --resume` (which also re-arms the one-shot override);
dispatch counts are cleared with `--reset-counts [--agent <name>]`. Never write these fields
to false yourself to get past a block — surface the block and the command to the user.

### Not version controlled

`bk/dev/shared/.workflow-state.json` and `checkpoints/` are per-machine and are not committed
(`bk-<platform> init --gitignore` writes the rules). What is committed is the plan directory,
`bk/dev/{feature}/` with its `.plan-state.json`.

So a plan pulled from another machine or another developer legitimately has no FSM state.
Re-derive the phase from `.plan-state.json` — `skills/bk-code/references/plan-consumption.md`
— rather than treating it as a fresh start.

### State recovery (do not delete the file)

`.workflow-state.json` is backed up to `.workflow-state.json.bak` on every write, and
`checkpoint-save` snapshots it. A read that finds the file corrupt **or missing** recovers
from the backup, then the newest checkpoint, and marks the state `recovered_from_backup` /
`recovered_from_checkpoint`. So deleting the file does not reset a workflow — start a new
episode instead.

### Starting the next workflow (new episode)

`commit` and `aborted` have no outgoing edges inside an episode. The next workflow starts by
writing an **opening phase** — `plan` (bk-code), `classify` (bk-debug), `analyze` (bk-refactor)
— straight over the terminal state. `fsm-guard.cjs` recognises that as a new episode and:

- lets it through (`commit → plan` is not an invalid transition, it is a restart);
- starts `phase_history[]` and `phase_recurrence_count{}` from zero, so the previous feature's
  fix loops cannot halt the new one;
- increments `workflow_episode` and records the finished one in `previous_episode`.

The new workflow may be a different one: `bk-code` ending at `commit` followed by `bk-debug`
opening at `classify` is a valid restart. Any *other* phase written out of a terminal state is
still refused — resuming a committed workflow at `review` is a bug, not a restart. Never delete
`.workflow-state.json` to get unstuck; write the opening phase.

### Escalation Transitions

| From | To | Condition |
|------|----|-----------|
| review | escalated | `quality_fix_count >= max` AND critical findings remain |
| test | escalated | `test_fix_count >= max` AND tests still fail |
| escalated | commit | User chooses "commit as-is" |
| escalated | aborted | User chooses "abort/discard" |
| escalated | coding | User provides manual fix guidance |

---

## Fix Loop Rules

- Resume dev agent via `Task(resume: dev_agent_id)` with review findings.
- After fixes: selective re-dispatch only affected review agents.
- On max reached, transition to `escalated`: "Fix loop limit. Options: 1) Force continue, 2) Commit as-is, 3) Abort"

---

## On Resume After Compaction

0. If `workflow_paused: true` — the recurrence hard block fired. Do NOT continue;
   AskUserQuestion with the options from the block message.
1. Read `current_phase` and `phase_history[]` from `.workflow-state.json`
2. Resume from `current_phase` — do not re-execute completed phases
3. Check fix-loop counters before quality→coding transitions
4. Verify artifacts exist before proceeding

---

## Validation

Before writing `current_phase`:
1. Read current phase from file
2. Check transition table for current command
3. Verify transition is valid
4. Verify required artifact exists

`phase_history[]` and `phase_recurrence_count{}` are appended by `fsm-guard.cjs` on every
accepted transition — read them, do not hand-maintain them.

Phase re-entry 3+ times triggers `[REACTIVE-SIGNAL: fix_loop_stuck]`, then a hard block at 4.
See `reactive-orchestration.md`.

### Batch loops are not fix loops

`/bk-code` re-enters `coding → testing → review` once per execution batch. On **successful
batch completion**, write `batch: N+1` together with `phase_recurrence_count: {}`, leaving
`current_phase` unchanged (a non-transition write, so the guard lets it through). Without
that reset a 4-batch plan is blocked at batch 3 as if it were stuck. Never reset the counter
to get out of a fix loop — only batch progress earns it.
See `skills/bk-code/references/workflow-state.md`.
