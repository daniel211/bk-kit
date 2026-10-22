# Commit Phase

Transition: `review → commit` (or `code → commit` for Trivial)

## Commit Gate (Always Required)

Show to user:
- Diff summary (files changed, lines added/removed)
- Fix description (1-2 sentences)
- Review score (if available)
- Unresolved warnings (if any)

Ask user approval before committing.

## On Approval

```
Task(subagent_type: "bk-git-manager", prompt: "
  Task: Commit the fix {fix_name}
  Fix: {fix_name}
  Files changed: {files_from_impl_result} (+ new ?? files of this fix, git add skips them)
  Commit type: fix
  Commit message format: fix({module}): {brief description}
  Output: commit SHA (report back to conductor)
")
```

## Auto-Commit (Autonomous Mode Only)

In `--auto` mode, if review score >= 9.5 AND no critical:
- Show diff summary
- Auto-commit without explicit approval
- Still use bk-git-manager for proper commit format

## State Output

```json
{
  "current_phase": "commit",
  "commit_approved": true|false
}
```
