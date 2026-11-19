---
paths:
  - .bk-dispatch-queue.json
  - .autodream/**
---

<!-- Scoped to the queue file, not bk/dev/**. See docs/kit-dev/add-rule.md. -->

# Dispatch Integration Guide

> Reference for integrating beer-kit with Claude Code Dispatch (Q1 2026+).

## Overview

Dispatch enables overnight/autonomous workflows by queuing tasks with dependencies.
Tasks execute sequentially or in parallel based on their dependency graph, without requiring a live session.

## beer-kit + Dispatch

### Task Queue Structure

```json
{
  "tasks": [
    {"id": "T1", "goal": "bk-bootstrap", "context": "{project_path}", "depends": []},
    {"id": "T2", "goal": "bk-plan", "context": "{feature}", "depends": ["T1"]},
    {"id": "T3", "goal": "bk-code", "context": "{plan_path}", "depends": ["T2"]},
    {"id": "T4", "goal": "bk-test", "context": "{plan_path}", "depends": ["T3"]}
  ]
}
```

### Triggering Dispatch Mode

```
/bk-autopilot {feature} --dispatch
```

This creates a Dispatch task queue instead of running synchronously.
The conductor writes the task queue to `.bk-dispatch-queue.json` and exits.
Dispatch runtime picks up and executes tasks in dependency order.

### Failure Handling

- Task fails → retry 1x with simplified scope
- Second failure → mark task as BLOCKED, notify user
- Dependent tasks → status WAITING until dependency resolves

Failure state written to `.bk-dispatch-queue.json`:
```json
{
  "id": "T3",
  "status": "BLOCKED",
  "error": "bk-code failed after 2 attempts",
  "blocked_dependents": ["T4"]
}
```

### Permissions

Each task inherits beer-kit's permission profile:
- **Read**: all project files
- **Write**: `bk/` directory, source files within plan scope
- **Bash**: build commands, test commands
- **No**: git push (requires explicit approval)

Permission profiles:

| Profile | Auto-Approve | Require Approval |
|---------|-------------|------------------|
| **development** | read, analyze, format, addTest, addComment | deleteFile, modifyBuildConfig, pushToMain, modifyAuth, modifyPayment |
| **review** | read, analyze | anyWrite, anyEdit, anyBash |
| **hotfix** | read, write, edit, bash, test | pushToMain, deleteFile |

_Source: `config/auto-mode-profiles.json`_

### Prerequisites

- Claude Code with Dispatch feature enabled
- beer-kit installed and configured (`bk-platform init`)
- Project bootstrapped (foundation docs present in `bk/docs/foundation/`)

### Migration from Synchronous

1. Run `/bk-bootstrap` normally (requires interaction for first time)
2. For subsequent features: `/bk-autopilot {feature} --dispatch`
3. Monitor via Dispatch dashboard or status channel

## Channels Protocol (Future)

When Claude Code Channels become available:
- Status channel: `bk-status-{feature}` — agents report progress
- Artifact channel: `bk-artifacts-{feature}` — share code/test results
- Observable by user dashboard in real-time

### Channel Message Format

```json
{
  "channel": "bk-status-{feature}",
  "type": "progress",
  "agent": "bk-code",
  "phase": "Phase 2",
  "status": "completed",
  "files_written": 3,
  "timestamp": "{ISO}"
}
```

## Notes

- Dispatch is designed for well-scoped features with clear foundation docs
- Interactive steps (AskUserQuestion) are skipped or use defaults in dispatch mode
- Review steps produce reports but do not block — user reviews async
