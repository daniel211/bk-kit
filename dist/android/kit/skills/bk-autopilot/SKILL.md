---
name: bk-autopilot
description: "Auto-chain bk-plan → approval gate → bk-code in a single command."
user-invocable: true
argument-hint: "<feature-description> [--mode auto|plan-only|dev-only] [--plan-path PATH] [bk-plan flags...] [bk-code flags...]"
---

# Autopilot: $ARGUMENTS

Plan and implement a feature end-to-end with a single command.
Chains bk-plan → user approval → bk-code automatically.

<Use_When>
- User wants to go from idea to implementation in one shot
- User says "autopilot", "plan and build", "end to end"
- Feature is well-defined enough to plan and implement
</Use_When>

<Do_Not_Use_When>
- Bug fix needed — use /bk-debug
- Code review only — use /bk-review
- Plan already exists and user wants to resume — use /bk-code directly
- User wants manual control over planning — use /bk-plan
</Do_Not_Use_When>

## Modes

| Mode | Flag | Behavior |
|------|------|----------|
| **auto** (default) | `--mode auto` | bk-plan → approval gate → bk-code |
| **plan-only** | `--mode plan-only` | Run bk-plan only (equivalent to `/bk-plan`) |
| **dev-only** | `--mode dev-only` | Resume from existing plan (requires `--plan-path`; equivalent to `/bk-code`) |

## Flag Passthrough

All bk-plan and bk-code flags are forwarded to the respective skill:
- bk-plan flags: `--fast`, `--deep`, `--parallel`, `--sequential`, `--figma`, `--openapi`, `--docs`
- bk-code flags: `--fast`, `--no-review`, `--parallel`, `--sequential`

Example: `/bk-autopilot "login screen" --deep --parallel`
→ bk-plan receives `--deep --parallel`, bk-code receives `--parallel`

## Workflow

```
[0. Pre-Flight Check] → [1. Parse Arguments] → [2. Plan Phase] → [3. Approval Gate] → [4. Dev Phase] → [5. Summary]
```

### Step 0: Pre-Flight Check

- IF `bk/docs/foundation/overview.md` missing AND feature is not trivial:
  - AskUserQuestion: "Foundation docs missing. Run /bk-bootstrap first?"
  - If yes → invoke `/bk-bootstrap`, then continue
  - If no → warn "Code quality may be reduced", continue
- IF BRD/design specs detected in project (files matching `*brd*`, `*brief*`, `*requirements*` in root or `docs/`) AND no `bk/dev/{feature}/srs/01-overview.md`:
  - Suggest: "BRD detected. Consider /bk-spec first for structured requirements."

### Step 1: Parse Arguments

- Extract `<feature-description>` from $ARGUMENTS
- Detect `--mode` (default: `auto`)
- If `--mode dev-only`: require `--plan-path`, skip to Step 4
- If `--mode plan-only`: run Steps 1-3 only (stop after approval)
- Separate bk-plan flags vs bk-code flags

### Step 2: Plan Phase

- Invoke `/bk-plan <feature-description> [bk-plan flags...]`
- Capture output plan directory path from bk-plan result
- If bk-plan fails or user cancels → stop, report failure

### Step 3: Approval Gate

- bk-plan already presents the plan and asks: approve / revise / cancel
- **approve** → continue to Step 3b (Plan Completeness Gate)
- **revise** → bk-plan handles revision loop internally, then re-present
- **cancel** → stop, report cancellation
- If `--mode plan-only` → stop here after approval, output the bk-code command

### Step 3b: Plan Completeness Gate

Before transitioning from bk-plan to bk-code, validate:

1. **Plan file exists** — `bk/dev/{feature}/plan.md` must exist and have content > 0 lines
2. **Sub-task files exist** — at least 1 `sub-task-NN-*.md` file
   (`phase-*.md` is a retired naming — if only those exist the plan predates the current bk-plan; re-run `/bk-plan`)
3. **Sub-task file completeness** — each sub-task file must contain:
   - `## Scope` section (or, in a pre-0.6.0 plan, an equivalent context/worklist heading)
   - `## Tasks` section with at least one `- [ ]` item
   - File paths referenced (at least 1 concrete file path)

   A file missing `## Tasks` but otherwise complete is a pre-0.6.0 plan, not a failure:
   warn that tracking will be one task per sub-task, and continue. Everything else on this
   list still has to pass. See `bk-code/references/plan-consumption.md` §Legacy plans.
4. **Dependencies declared** — if >1 sub-task file, dependencies must be stated in YAML `depends:`

**On validation failure:**
- Report which checks failed
- Ask user: "Plan incomplete. Fix plan first, or proceed anyway?"
- Options: [Fix plan] [Proceed] [Cancel]

**On validation pass:**
- Log: "Plan validation passed. Proceeding to bk-code."
- Transition automatically

### Step 4: Dev Phase

- Invoke `/bk-code {plan-dir}/plan.md [bk-code flags...]`
- Plan directory comes from Step 2 output (auto mode) or `--plan-path` (dev-only mode)
- bk-code handles full implementation pipeline (execute, review, test, finalize)

### Step 5: Summary

Report to user:
- Plan location: `bk/dev/{feature}/plan.md`
- Sub-tasks completed
- Files modified
- Commit reference (if bk-code finalized)
- Any unresolved issues from review/test cycles

## Constraints

- Never skip the approval gate in `auto` mode — user must approve before implementation
- **Division of Labor**: delegate FULLY to bk-plan and bk-code — DO NOT write plan files, code, tests, or docs yourself
- If bk-plan or bk-code fails, escalate to user — DO NOT attempt to implement their work directly
- All bk-plan constraints apply during planning phase (including CRITICAL ENFORCEMENT: bk-planner delegation)
- All bk-code constraints apply during dev phase (including batch-execution agent dispatch)
- If either sub-skill escalates to user, autopilot waits for resolution
