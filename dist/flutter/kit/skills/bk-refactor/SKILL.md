---
name: bk-refactor
description: "FSM-driven refactor workflow — analyze scope, refactor via dev agent, test existing behavior, fix-loop max 1, commit."
user-invocable: true
argument-hint: "[refactor description: rename X to Y / extract Z from W / restructure]"
---

# Refactor: $ARGUMENTS

FSM-driven refactoring workflow. Analyzes scope in main session, dispatches platform dev agent for changes, verifies all existing tests still pass. Structure changes only — behavior is preserved.

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

See `.claude/rules/state-machine.md` for full transition table and required artifacts.

Fix-loop max 1: 1 automatic retry, then escalate to user.

## Pre-loaded Context

- **Workflow state**: `bk/dev/shared/.workflow-state.json`
- **Platform**: detected from project files — see `.claude/rules/core-rules.md`

---

## Phase 1: Analyze

Transition state: `(none) → analyze`.

### Foundation Context Loading
Before dispatching the dev agent:
1. Read `bk/docs/foundation/architecture.md` + `bk/docs/foundation/code-guidelines.md`
2. Include in dev agent prompt to ensure refactor follows project conventions

Main session identifies refactor scope:
1. Parse refactor type from `$ARGUMENTS`: rename / extract / move / restructure / modernize
2. Search codebase with Grep/Glob to find affected files and symbols
3. Map all references to changed symbols
4. Estimate blast radius (files and symbols affected)

Show to user:
- Refactor type and scope description
- Affected files with symbol counts
- Proposed approach

Write to `.workflow-state.json`: `refactor_type`, `affected_files`, `complexity_tier`, `platform`.

No approval gate for obvious/small scope. For Standard/Complex (many files or cross-cutting changes), **use `AskUserQuestion` tool**:
```json
{
  "questions": [{
    "question": "Refactor affects {N} files across {scopes}. Confirm scope?",
    "header": "Refactor Scope Approval",
    "options": [
      { "label": "Proceed", "description": "Apply refactor to all affected files" },
      { "label": "Narrow scope", "description": "I'll specify which files" },
      { "label": "Cancel" }
    ]
  }]
}
```

Transition state: `analyze` complete when scope is identified.

## Phase 2: Refactor

Transition state: `analyze → refactor`.

Dispatch platform dev agent foreground (opus):
```
Task(subagent_type: "bk-{platform}-developer", model: "opus", prompt: "
  Refactor goal: {description}
  Refactor type: {rename|extract|move|restructure|modernize}
  Affected files: {file_list_with_line_ranges}
  Constraint: preserve ALL existing behavior — all tests must pass after refactor
  Constraint: minimal blast radius — change only what is needed
  Output: bk/dev/shared/{platform}/{feature}-impl-result.json
")
```

After agent returns:
- Verify `impl-result.json` exists with `files_changed` (min 1)
- Verify no orphaned references remain (renamed symbol still called by old name)
- Write `dev_agent_id` to `.workflow-state.json`

## Phase 3: Test

Transition state: `refactor → test`.

Dispatch bk-unit-test-agent background (sonnet) to verify no regressions:
```
Task(subagent_type: "bk-unit-test-agent", model: "sonnet", run_in_background: true, prompt: "
  Run existing tests — verify no regressions introduced by refactor
  impl-result: bk/dev/shared/{platform}/{feature}-impl-result.json
  Output: bk/dev/shared/reports/unit-test-{platform}-{feature}.json
  IMPORTANT: Do NOT write new tests — only run existing suite
")
```

### Fix Loop (max 1)

If tests fail and `refactor_fix_count < 1`:
1. Resume dev agent: `Task(resume: dev_agent_id)` with test failure details
2. Re-dispatch bk-unit-test-agent
3. Increment `refactor_fix_count` in `.workflow-state.json`
4. On limit reached, **use `AskUserQuestion` tool**:
   ```json
   {
     "questions": [{
       "question": "Refactor fix loop limit (1) reached. Tests still failing.",
       "header": "Fix Loop Limit",
       "options": [
         { "label": "Force continue", "description": "Proceed despite test failures" },
         { "label": "Rollback", "description": "Revert refactor changes" },
         { "label": "Abort", "description": "Stop workflow" }
       ]
     }]
   }
   ```

No review phase — refactor preserves behavior by definition.

## Phase 4: Commit

Transition state: `test → commit`.

**Commit gate (always required):** Show files changed, test results via `AskUserQuestion` tool:
```json
{
  "questions": [{
    "question": "Refactor complete.\nFiles changed: {N}\nTests: {PASS|FAIL}\n\nCommit?",
    "header": "Refactor Commit Gate",
    "options": [
      { "label": "Commit" },
      { "label": "Review changes first" },
      { "label": "Cancel" }
    ]
  }]
}
```

On approval:
```
Task(subagent_type: "bk-git-manager", model: "haiku", prompt: "
  Task: Commit the refactor {description}
  Refactor: {description}
  Files changed: {files_from_impl_result}
  Commit type: refactor
  Output: commit SHA (report back to conductor)
")
```

### Finalize (after commit)

Dispatch 3 mandatory agents for workflow completion:
1. **bk-project-manager** → sync-back plan checkboxes if plan exists
   ```
   Task(subagent_type: "bk-project-manager", model: "haiku", run_in_background: true,
     description: "Sync plan progress", prompt: "
     Task: Sync-back plan progress at {plan-dir}
     Sync-back plan at {plan-dir}:
     - Read ALL phase-*.md files
     - Mark completed [ ] → [x] across all phases
     - Update plan.md status/progress
     - Report unresolved mappings
     Output: {plan-dir}/plan.md (updated status + checkboxes)
   ")
   ```
2. **bk-docs-writer** → update docs if refactor changes public API or architecture
3. **bk-git-manager** → stage and commit with conventional message (may already be done above)

For refactors without an associated plan: skip bk-project-manager.
For internal-only refactors (no public API change): skip bk-docs-writer.
All 3 mandatory when refactor is part of a planned workflow.

## State Persistence

File: `bk/dev/shared/.workflow-state.json`

```json
{
  "command": "bk-refactor",
  "current_phase": "analyze|refactor|test|commit",
  "phase_history": [{"from": "", "to": "", "timestamp": ""}],
  "refactor_fix_count": 0,
  "refactor_type": "rename|extract|move|restructure|modernize",
  "complexity_tier": "Trivial|Standard|Complex",
  "platform": "ios|android|flutter",
  "dev_agent_id": null,
  "affected_files": []
}
```

## On Resume After Compaction

1. Read `current_phase` from `.workflow-state.json`
2. Resume from `current_phase` — do not re-execute completed phases
3. Check `refactor_fix_count` before test→refactor transitions
4. If `current_phase: "refactor"` — check if `impl-result.json` exists (dev agent may have finished)

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

This skill operates within the reactive orchestration framework.
After each agent dispatch and return, check output for reactive signals.

**Helper skills available for dispatch at any point in this workflow:**
- **bk-brainstormer** — agent stuck on approach, architecture concern
- **bk-docs-seeker** — unknown API/framework error
- **bk-sequential-thinking** — complex decomposition, conflicting data
- **bk-problem-solving** — creative breakthrough needed, fix loops

**Decision tables:** `rules/reactive-orchestration.md`
**User interaction:** `rules/user-interaction-protocol.md`
