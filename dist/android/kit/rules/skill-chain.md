---
paths:
  - mk/dev/**
---

# Skill Chain Registry

Rules and registry for automatic skill chaining in beer-kit.

## Chain Map

| Current Skill | Outcome Condition | Next Suggested Skill |
|---------------|-------------------|----------------------|
| bk-bootstrap | success | `/bk-plan` or `/bk-spec` (if BRD detected) |
| bk-spec | success / complete | `/bk-plan` |
| bk-plan | approved | `/bk-code` or `/bk-autopilot --mode dev-only` |
| bk-autopilot | plan-only complete | `/bk-code {plan-path}` |
| bk-code | committed | `/bk-docs` (if Complex tier) |
| bk-debug | fixed | `/bk-test` |
| bk-refactor | complete | `/bk-test` |
| bk-test | complete | `/bk-code-review` (if issues found) |

## Rules

### 1. Chain Trigger Conditions
- A chain suggestion is only emitted when the current skill reaches a **terminal phase**:
  `commit`, `completed`, `approved`, `fixed`, `escalated`
- Never suggest chaining from a failed or cancelled workflow.

### 2. Suggestion Format
Output: `[SUGGEST-NEXT] {current_skill} complete. Next: {next_command} {plan_path_if_applicable}`

### 3. BRD Detection
- BRD detected if any of these exist in the project root or `docs/`:
  - Files matching `*brd*`, `*brief*`, `*requirements*` (case-insensitive)
  - A `docs/design/` directory with spec files
- When BRD is detected after bk-bootstrap: suggest `/bk-spec` before `/bk-plan`

### 4. Complexity-Aware Chaining
- **Trivial** tier: skip `/bk-docs` after bk-code
- **Standard** tier: suggest `/bk-docs` only if docs are missing
- **Complex** tier: always suggest `/bk-docs` after bk-code commit

### 5. Chain History
- Each invoked skill records itself in `.workflow-state.json` under `chain_history[]`
- Format: `{ skill, ts, output_path, status }`
- Used by compact-recovery.cjs to restore chain context after compaction

### 6. No Auto-Execution
- Skill chain suggestions are advisory only — the conductor or user must approve
- Never automatically invoke the next skill without user confirmation
- Exception: bk-autopilot in `auto` mode (governed by its own approval gate)
