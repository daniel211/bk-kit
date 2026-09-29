---
paths:
  - .claude/agents/**
---

# Agent Memory Protocol

> Shared read/write rules for per-agent `MEMORY.md`. Each agent's own `## Agent Memory`
> section names only its memory directory and what that agent should save; everything
> else lives here.

## On start

Read `MEMORY.md` from the system-provided agent memory directory if it exists. Never
derive the memory path from the current working directory.

## On finish

If you discovered something new about this project that future runs should know, append
to `MEMORY.md` in that same system-provided directory. Only save durable facts — not
task-specific details, not the result of the task you just ran.

## Path rule

Use the exact memory directory supplied in your system prompt — it is the folder named
after your agent (e.g. `bk-planner/`). Never read or write another agent's memory folder.

- **`memory: project`** — the directory belongs to the project. If the path is relative,
  resolve it against the **project root**, never against your current working directory.
- **`memory: user`** — the directory lives under the user's home directory, never inside
  the project. Never derive it from the current working directory either.

**Always use the absolute path.** Build memory paths from the project-root absolute path
(`<project-root>/.claude/agent-memory/<agent>/`) or the exact directory in your system prompt.
Never `mkdir -p .claude/agent-memory/...` (or `touch`, `cp`, redirect into it) with a relative
path: relative to `bk/dev/<feature>/` or a source folder it creates a stray directory that the
guard then refuses to let you use. The memory directory already exists — just write the file.
The guard denies such Bash commands as well as Write/Edit.

**Git worktrees:** if you are working inside a git worktree, the project root is still the
**main repository**, not the worktree. A worktree has its own `.claude/` directory and
looks like a project root, but memory written there is invisible to every other worktree
and will be blocked. Do not create a second `.claude/agent-memory` folder anywhere else.

## Format

Append one dated block per run, newest at the bottom:

```markdown
## {date} — {one-line summary}
- {fact learned}
```

## What not to save

- Task-specific detail ("fixed the crash in LoginViewModel on 2026-03-02")
- Anything already written to a report under `bk/dev/shared/reports/`
- Secrets, tokens, absolute paths outside the project
