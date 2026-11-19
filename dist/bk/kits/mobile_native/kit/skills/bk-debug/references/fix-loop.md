# Fix Loop Logic

## Trigger Conditions

| Mode | Trigger | Max Cycles |
|------|---------|------------|
| Auto | critical_count > 0 | 2 |
| HITL | User selects "Fix" | 2 |
| Quick | critical_count > 0 | 1 |

## Fix Loop Flow

```
1. Review finds critical issues
2. Check quality_fix_count < max_cycles
3. Resume dev agent: Task(resume: dev_agent_id, prompt: "Fix: {findings}")
4. After fix: selective re-dispatch ONLY affected reviewers
5. Increment quality_fix_count in .workflow-state.json
6. Re-evaluate review results
```

## Escalation (Max Reached)

Present to user:
```
Fix loop limit ({max_cycles}).
Review score: {score}/10, {N} unresolved critical issues.

Options:
1) Force continue — proceed to commit with known issues
2) Commit as-is — commit current state, track issues
3) Abort — discard changes, manual investigation needed
```

## Build Failure vs Review Failure

Separate counters:
- `build_retry_count` (max 3) — build/compile errors in code phase
- `quality_fix_count` (max 1-2) — review findings in review phase

Both tracked in `.workflow-state.json`. Independent limits.

## Selective Re-dispatch

After fix loop iteration, only re-dispatch reviewers that found critical issues:
- If only bk-code-reviewer had critical → re-dispatch only bk-code-reviewer
- If bk-security-auditor had critical → re-dispatch bk-security-auditor too
- Do NOT re-dispatch agents that passed clean
