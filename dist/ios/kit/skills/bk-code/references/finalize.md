# Finalize (Step 6)

Sync-back all progress, update docs, commit.

## Full Sync-Back (CRITICAL)

Sweep ALL `sub-task-NN-*.md` files in plan directory — not just the current sub-task.

### Checkbox sync

For each sub-task file:
1. Read the `## Tasks` section ONLY (never `## Edge Cases & Risks`, `## Success Criteria`
   or `## Review Checklist`)
2. Cross-check with completed Claude Tasks (by metadata.subTaskFile)
3. Mark every completed item: `- [ ]` → `- [x]`
4. Include earlier sub-tasks finished before current session
5. Pre-0.6.0 sub-task (no `## Tasks`): tick nothing. Set frontmatter `status: complete` when
   its single task completed, and record it in `.plan-state.json`. See
   `references/plan-consumption.md` §Legacy plans.

### Plan status update

1. For each sub-task: if ALL `## Tasks` checkboxes `[x]` → set YAML `status: complete`
   (legacy sub-task: its one task completed → `status: complete`)
2. Update the plan.md sub-task table: Status column matches sub-task YAML
3. If ALL sub-tasks complete → plan.md YAML `status: completed`

### State file

Write final `.plan-state.json`:

```json
{
  "feature": "{from plan.md}",
  "status": "complete",
  "platforms": ["{from plan.md}"],
  "currentStep": "finalized",
  "completedSteps": [1, 2, 3, ...],
  "completedSubTasks": N,
  "totalSubTasks": M,
  "updatedAt": "{ISO timestamp}"
}
```

### Claude Tasks

TaskUpdate all remaining tasks to `completed` after sync-back verification.

## Docs Impact Evaluation

Before dispatching bk-docs-writer, evaluate impact:

| Impact | Criteria | Action |
|--------|----------|--------|
| none | Config-only changes, internal refactor | Skip bk-docs-writer dispatch |
| minor | New API, changed behavior, new patterns | bk-docs-writer updates existing pages |
| major | New architecture, breaking changes | bk-docs-writer + notify user |

## Generation Report

If any `stepResults[N].generation` exists in `.plan-state.json`:

1. Run: `npx tsx src/scripts/generation-report.ts --state {plan-dir}/.plan-state.json --out {plan-dir}/reports/`
2. Output: `{plan-dir}/reports/generation-summary.md`
3. If script fails: log warning, continue finalization (best-effort, non-blocking)

### Plan Sync-Back (MANDATORY — before docs and git)

```
Task(subagent_type: "bk-project-manager", model: "haiku", run_in_background: true,
  description: "Sync plan progress", prompt: "
  Task: Sync-back plan progress at {plan-dir}
  Sync-back plan at {plan-dir}:
  - Read ALL sub-task-*.md files
  - Mark completed [ ] → [x] in each file's `## Tasks` section only
  - Files with no ## Tasks section are pre-0.6.0: set frontmatter status only, tick nothing
  - Update plan.md status/progress
  - Report unresolved mappings
  Output: {plan-dir}/plan.md (updated status + checkboxes)
")
```

### Finalize Validation
After dispatching all 3 agents (project-manager, docs-writer, git-manager), verify:
- All 3 returned successfully
- Plan files updated with completion marks
- Docs updated (or explicitly noted "no update needed")
- Git commit created

If any agent fails: retry once, then escalate to user.

### Finalize Phase (Parallel)

Dispatch BOTH agents in ONE message:
1. **bk-docs-writer** (background) — update documentation based on implementation
2. **bk-git-manager** (background) — stage, commit with conventional message

> ⚠️ Constraint: docs-writer must NOT reference commit hash (since commit hasn't happened yet).
> git-manager commits all changes including doc updates when both complete.

**Sequence:**
1. Dispatch both in parallel
2. Wait for bk-docs-writer to complete
3. Wait for bk-git-manager — it should stage docs-writer output too
4. If bk-docs-writer finishes after git-manager, run git amend

## Docs Update

Dispatch bk-docs-writer in background (skip if impact = none):

```
Task(subagent_type: "bk-docs-writer", model: "sonnet", description: "Update docs", run_in_background: true, prompt: "
  Task: Update project docs for the completed feature
  Feature completed: {plan title from plan.md}
  Changed files: {summary of files created/modified}
  Docs impact: {none|minor|major}
  Reason: {brief justification}
  Check docs/ for updates needed:
  - development-roadmap.md — progress status
  - project-changelog.md — new entry
  - system-architecture.md — if architecture changed
  - code-standards.md — if new patterns introduced
  ⚠️ Do NOT reference commit hashes — commit has not happened yet.
  Output: updated docs/*.md files (list each changed file, or state "no update needed")
")
```

## Git Commit

Dispatch bk-git-manager in same message as bk-docs-writer:

```
Task(subagent_type: "bk-git-manager", model: "haiku", description: "Commit changes", run_in_background: true, prompt: "
  Task: Stage and commit changes for {plan title}
  Stage and commit changes for: {plan title}
  Conventional commit format. Scope: {feature name}.
  Do NOT commit .env or credentials.
  Do NOT skip pre-commit hooks.
  NOTE: bk-docs-writer may still be running. Stage all current files.
  If docs updates land after your commit, the orchestrator will run git amend.
  Output: commit SHA + conventional message (report back to conductor)
")
```

## Output

```
✓ Finalized: {N}/{M} sub-tasks complete
  Files: {count} created, {count} modified
  Tests: {pass}/{total} passed
  Review: {score}/10
  Commit: {hash} {message}
```
