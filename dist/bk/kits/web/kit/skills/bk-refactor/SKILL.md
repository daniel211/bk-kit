---
name: bk-refactor
description: "FSM-driven refactor workflow — analyze scope, refactor via dev agent, test existing behavior, fix-loop max 1, commit."
user-invocable: true
argument-hint: "[refactor description: rename X to Y / extract Z from W / restructure]"
---

# Refactor: $ARGUMENTS

FSM-driven refactoring workflow. Analyzes scope in the main session, dispatches the platform dev agent for changes, verifies all existing tests still pass. Structure changes only — behavior is preserved.

<Use_When>
- User wants to rename a symbol, class, or module
- User wants to extract a component, function, or module
- User wants to move or restructure files
- User says "refactor", "rename", "extract", "move", "restructure", "modernize"
</Use_When>

<Do_Not_Use_When>
- Bug fix needed — use /bk-debug
- New feature — use /bk-code
- Performance analysis without changes — use /bk-review
</Do_Not_Use_When>

## FSM Transitions

```
(none) → analyze → refactor → test → [fix-loop max 1] → commit
                     ↑                      ↓
                     └── test ──────────────┘ (1 retry only)
```

Fix-loop max 1: one automatic retry, then escalate to the user.
Full transition table + required artifacts: `.claude/rules/state-machine.md`.
State file schema + resume-after-compaction: `references/workflow-state.md`.

## Pre-loaded Context

- **Workflow state**: `bk/dev/shared/.workflow-state.json`
- **Platform**: detected from project files — see `.claude/rules/core-rules.md`

## Phase 1: Analyze — `(none) → analyze`

1. Read `bk/docs/foundation/architecture.md` + `code-guidelines.md`; both go into the dev agent
   prompt so the refactor follows project conventions
2. Parse the refactor type from `$ARGUMENTS`: rename / extract / move / restructure / modernize
3. Grep/Glob for affected files and symbols, map ALL references, estimate blast radius
4. Show the user: refactor type + scope, affected files with symbol counts, proposed approach
5. Write `refactor_type`, `affected_files`, `complexity_tier`, `platform` to `.workflow-state.json`

Standard/Complex scope (many files or cross-cutting) → **scope approval gate** via
`AskUserQuestion` (`references/phase-dispatch.md`). Trivial scope needs no gate.

## Phase 2: Refactor — `analyze → refactor`

Dispatch `bk-{platform}-developer` foreground (opus) with the goal, type, affected files, and the
two hard constraints: preserve ALL existing behavior, minimal blast radius. Output:
`bk/dev/shared/reports/impl-{feature}-refactor.md`.

After it returns: verify the impl report exists with `files_changed` (min 1), verify no orphaned
references remain, write `dev_agent_id`. Load: `references/phase-dispatch.md`

## Phase 3: Test — `refactor → test`

Dispatch `bk-unit-test-agent` background (sonnet) to run the EXISTING suite only — it must not
write new tests. Failures → fix loop (max 1): resume the dev agent, re-test, increment
`refactor_fix_count`; at the limit, escalate via `AskUserQuestion` (force continue / rollback /
abort). Load: `references/phase-dispatch.md`

No review phase — refactor preserves behavior by definition.

## Phase 4: Commit — `test → commit`

**Commit gate (always required):** show files changed + test results via `AskUserQuestion`
(commit / review first / cancel). On approval dispatch `bk-git-manager` (haiku), commit type
`refactor`.

**Finalize:** `bk-project-manager` (sync-back plan checkboxes — skip when there is no plan),
`bk-docs-writer` (skip for internal-only refactors), `bk-git-manager`. All three are mandatory when
the refactor is part of a planned workflow. Load: `references/phase-dispatch.md`

## Constraints

- Fix loop max: 1 (then escalate to user)
- No review phase — behavior preservation verified by tests only
- Existing tests MUST pass — no regressions allowed
- Minimal blast radius: change only what is needed for the refactor goal
- State transitions must follow `.claude/rules/state-machine.md`

## References

- State machine: `.claude/rules/state-machine.md`
- Core rules (platform detection): `.claude/rules/core-rules.md`
- Task tracking: `Skill("bk-task-tracking")`
- Agent contract: `Skill("bk-agent-contract")`

## Reactive Orchestration Reminder

After each agent dispatch returns, check its output for reactive signals. Helper skills
dispatchable at any point: **bk-brainstormer** (stuck on approach / architecture concern),
**bk-docs-seeker** (unknown API or framework error), **bk-sequential-thinking** (complex
decomposition, conflicting data), **bk-problem-solving** (fix loops, breakthrough needed).

**Decision tables:** `rules/reactive-orchestration.md` — **User interaction:** `rules/user-interaction-protocol.md`
