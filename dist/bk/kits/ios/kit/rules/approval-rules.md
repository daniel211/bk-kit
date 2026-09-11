# Approval Rules

## Risk-Based Approval

| Risk | Commands | Gates |
|------|----------|-------|
| **None** | /bk-test, /bk-review, /bk-analyze, /bk-docs | Auto-approve |
| **Low** | /bk-debug trivial, /bk-commit | Commit gate only |
| **Medium** | /bk-debug standard, /bk-code simple, /bk-refactor | Analysis + commit gates |
| **High** | /bk-code standard/complex | Plan + dispatch + commit gates |

## Always Ask Before

- Creating new plans (unless trivial fix)
- Committing code
- Creating MR/PR

## Auto-Skip Rules

- **Post-task dispatch gate**: Skip for Simple routing. Background agents are low-risk.
- **Analysis gate**: Skip for Trivial fixes where cause is self-evident.

On session resume, verify approval from plan file (`approval_status`), not conversation history.

## Review Mode Thresholds (bk-debug)

| Mode | Auto-approve | Fix Loop Trigger | Max Cycles |
|------|-------------|-----------------|------------|
| `--auto` (default) | critical == 0 AND warning < 3 AND test_pass_rate > 90% | critical > 0 | 2 |
| `--review` | Never auto-approve | Always show findings | 2 |
| `--quick` | critical == 0 AND warning == 0 | critical > 0 | 1 |

## Approval Conditions

| Decision | Conditions |
|----------|------------|
| **Auto-approve** | critical == 0 AND warning < 3 AND test_pass_rate > 90% |
| **Fast-track** | critical == 0 AND warning == 0 (all clear) |
| **Escalate to user** | critical > 0 OR warning >= 5 |
| **Fix loop** | critical > 0 — auto-trigger fix cycle (max cycles per mode) |

Agents MUST report: `Critical: {n} | Warning: {n} | Info: {n} | Test pass rate: {%} | Verdict: approve/request_changes/escalate`
