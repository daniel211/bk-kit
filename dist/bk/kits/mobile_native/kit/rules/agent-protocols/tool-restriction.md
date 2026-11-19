---
paths:
  - .claude/agents/**
---

# Tool Restriction Protocol

> Enforce tool boundaries per agent type. No agent below may modify project code
> except the Write/Edit categories that explicitly allow it.

## Agent Tool Categories

| Category | Agents | Allowed Tools | Forbidden Tools |
|----------|--------|---------------|-----------------|
| **Read-only** | bk-code-reviewer, bk-security-auditor, bk-performance-analyzer, bk-test-architect | Read, Grep, Glob, Write (reports only) | Edit, Bash, Task |
| **Read-only+Harness** | bk-gemini-reviewer, bk-codex-reviewer | Read, Grep, Glob, Write (reports only), Bash (harness allowlist only) | Edit, Task |
| **Write+Run** | bk-unit-test-agent | Read, Write, Edit, Grep, Glob, Bash | Task |
| **Write** | bk-device-test-agent (mobile kits only) | Read, Write, Edit, Grep, Glob | Bash, Task |
| **Full dev** | bk-ios-developer, bk-android-developer, bk-flutter-developer | Read, Write, Edit, Bash, Grep, Glob | Task |
| **Edit+util** | bk-docs-writer | Read, Edit, Write, Glob, Grep | Bash, Task |
| **Diag** | bk-debugger | Read, Bash, Glob, Grep | Edit, Task |
| **Utility** | bk-git-manager, bk-researcher | Read, Write, Grep, Glob, Bash | Task |
| **Planning** | bk-planner | Read, Glob, Grep, Bash | Task |
| **Design** | design-validator, design-spec-writer, design-asset-exporter | Read, Grep, Glob, Write, Bash | Edit, Task |
| **Read-only+Web** | bk-brainstormer | Read, Glob, Grep, WebSearch, WebFetch, Write (reports only) | Edit, Bash, Task |
| **Write+Run** | bk-code-simplifier | Read, Edit, Write, Bash, Glob, Grep | Task |
| **Coordination** | bk-project-manager | Read, Write, Edit (`bk/dev/**`, `bk/docs/**` only), Glob, Grep | Bash, Task |

## Enforcement

### In Agent Definitions

Read-only agents MUST include:
```
FORBIDDEN TOOLS: Edit, Bash, Task
If you need to modify code, report the need in your output — do not modify directly.
```

### Read-only + Harness (bk-gemini-reviewer, bk-codex-reviewer)

These agents run an external review CLI, so they need `Bash` — but only to drive that
harness. Each MUST include (naming its own harness):
```
FORBIDDEN TOOLS: Edit, Task — never modify project code.
Bash is allowed ONLY to invoke the Gemini review harness (`gemini`, `gemini-review.mjs`)
and read-only inspection commands. Any other command is a violation.
```
bk-codex-reviewer's harness is `codex` / `codex-review.mjs`, which runs
`codex exec --sandbox read-only`. Never `--dangerously-bypass-approvals-and-sandbox` or
`--full-auto`.

### Coordination (bk-project-manager)

This agent gets `Edit` even though it never writes code. The finalize sync-back step
(`bk-code/references/finalize.md`) requires it to tick `[ ]` → `[x]` inside existing
`sub-task-*.md` files and update `plan.md` progress. Without `Edit` the only way to
change those files is a full-file `Write`, which on a 200-1000 line plan silently drops
whatever the agent did not reproduce. `Edit` is the narrower, safer tool here.

Its boundary is path scope, not tool scope. It MUST include:
```
FORBIDDEN TOOLS: Bash, Task — coordination and reporting only, never modifies code.
Edit/Write scope: `bk/dev/**` and `bk/docs/**` only. Never implementation files.
`Write` creates new files only — changing an existing file always goes through `Edit`.
```

### In Dispatch Prompts

When dispatching read-only agents:
```
TOOL RESTRICTION: You are a READ-ONLY agent. Do NOT use Edit, Bash, or Task tools.
Write your report to the output file using the Write tool only.
```

For bk-gemini-reviewer / bk-codex-reviewer, substitute the harness variant — do NOT copy the line above onto
it, or it cannot run its own review:
```
TOOL RESTRICTION: You are READ-ONLY for project code. Do NOT use Edit or Task.
Use Bash strictly to invoke the Gemini (or Codex) review harness.
```

### Hook Enforcement

`verify-output.cjs` (SubagentStop, when the agent finishes) enforces tool restrictions from
the tool calls recorded in the agent's own transcript (`agent_transcript_path`):
1. Read-only agents: any `Edit` / `MultiEdit` / `NotebookEdit` / `Bash` call → `[TOOL-RESTRICT]` error;
   a `Write` outside `bk/` → `[TOOL-RESTRICT]` warning
2. For **Read-only+Harness**, any Edit-family call, plus any Bash command outside the harness
   allowlist (`agy` / `gemini-review.mjs` / `codex` / `codex-review.mjs` / read-only inspection), or any command carrying
   `--dangerously-bypass-approvals-and-sandbox` / `--full-auto` / `--dangerously-skip-permissions`
   → `[TOOL-RESTRICT]` error
3. Second layer on top of `permissionMode: plan` in agent frontmatter

**Scope of the hook:** it is a check of the agent's transcript after the fact, not a
sandbox. It catches and reports violations; it cannot prevent one mid-flight, and it is
skipped when the transcript cannot be read. Treat the agent frontmatter (`disallowedTools`)
as the primary boundary.
