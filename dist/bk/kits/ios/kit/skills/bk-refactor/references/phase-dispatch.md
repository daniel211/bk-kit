# Phase Dispatch & Approval Gates (bk-refactor)

Copy-paste dispatch syntax and the exact `AskUserQuestion` payloads for each phase.

## Phase 1 — scope approval (Standard/Complex only)

No gate for obvious/small scope. For many files or cross-cutting changes:

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

## Phase 2 — dev agent (foreground, opus)

```
Task(subagent_type: "bk-{platform}-developer", prompt: "
  Refactor goal: {description}
  Refactor type: {rename|extract|move|restructure|modernize}
  Affected files: {file_list_with_line_ranges}
  Constraint: preserve ALL existing behavior — all tests must pass after refactor
  Constraint: minimal blast radius — change only what is needed
  Output: bk/dev/shared/reports/impl-{feature}-refactor.md
    (impl report — markdown + YAML frontmatter, schema in bk-agent-contract §3)
")
```

After the agent returns: verify the impl report exists with `files_changed` (min 1), verify no
orphaned references remain (renamed symbol still called by its old name), and write `dev_agent_id`
to `.workflow-state.json`.

## Phase 3 — test agent (background, sonnet)

```
Task(subagent_type: "bk-unit-test-agent", model: "sonnet", run_in_background: true, prompt: "
  Run existing tests — verify no regressions introduced by refactor
  Impl report: bk/dev/shared/reports/impl-{feature}-refactor.md
  Output: bk/dev/shared/reports/unit-test-{platform}-{feature}.json
  IMPORTANT: Do NOT write new tests — only run existing suite
")
```

### Fix loop (max 1)

If tests fail and `refactor_fix_count < 1`: resume the dev agent (`Task(resume: dev_agent_id)`)
with the failure details, re-dispatch the test agent, and increment `refactor_fix_count`.
On limit reached:

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

## Phase 4 — commit gate (always required)

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
Task(subagent_type: "bk-git-manager", prompt: "
  Task: Commit the refactor {description}
  Refactor: {description}
  Files changed: {files_from_impl_result} (+ new ?? files of this refactor, git add skips them)
  Commit type: refactor
  Output: commit SHA (report back to conductor)
")
```

## Finalize (after commit)

1. **bk-project-manager** → sync-back plan checkboxes if a plan exists
   ```
   Task(subagent_type: "bk-project-manager", run_in_background: true,
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
2. **bk-docs-writer** → update docs if the refactor changes public API or architecture
3. **bk-git-manager** → stage and commit with a conventional message (may already be done above)

Refactor without an associated plan → skip bk-project-manager. Internal-only refactor (no public
API change) → skip bk-docs-writer. All 3 are mandatory when the refactor is part of a planned
workflow.
