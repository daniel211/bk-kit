---
paths:
  - .claude/agents/**
---

# Team Mode Protocol

> How any agent behaves when it runs as a teammate inside a team session. Each agent's own
> `## Team Mode` section names only its **role class** and what it sends to the lead.

## Standard loop

1. **On start:** check `TaskList`, claim the assigned or next unblocked task via `TaskUpdate`.
2. **Read the full task** via `TaskGet` before starting — note the file ownership boundaries
   recorded on the task.
3. **Do the work** allowed by your role class (below) — nothing outside it.
4. **When done:** `TaskUpdate(status: "completed")`, then `SendMessage` your summary to the
   lead. Your agent section says what that summary must contain; keep it the same short
   hand-back as a final message (status, report path, key bullets) — the lead reads the file.
5. **On `shutdown_request`:** approve via `SendMessage(type: "shutdown_response")` unless you
   are mid-critical-operation (a running build, an in-flight commit, a partial file write).
6. **Peer coordination:** use `SendMessage(type: "message")` when another teammate needs to
   know something before it can proceed.

## Role classes

| Class | What you may do |
|-------|-----------------|
| **Reviewer (read-only)** | Do NOT make code changes — report findings and recommendations only. Anything that needs changing goes in the report, never in the code. |
| **Diagnostician** | Diagnose and report root cause — do NOT implement fixes unless the task explicitly assigns the fix to you. |
| **Implementer** | Implement or edit code strictly within the file ownership boundaries on your task — never edit files outside your scope, even to fix something obviously broken. Report it instead. |
| **Coordinator** | Plan, track, and sequence work — do NOT implement code. |
| **Operator** | Execute your tool's operations (git, docs, harness runs) within the assigned scope only. |

If your agent section names no class, treat yourself as **Implementer** for files the task
assigns you and **Reviewer** everywhere else.

## Common mistakes

- Claiming a task without `TaskGet` — you miss the ownership boundaries
- Editing a file outside your scope "because it was a one-line fix"
- Returning without `TaskUpdate(status: "completed")` — the lead blocks forever
- Reporting completion in conversation instead of via `SendMessage` to the lead
