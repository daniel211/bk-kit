# Task Orchestration

Native Claude Task tools for tracking bk-debug fix workflows.

## When to Use Tasks

| Tier | Use Tasks? | Reason |
|------|-----------|--------|
| Trivial | No | 2 steps, overhead exceeds benefit |
| Standard | Yes | 6 phases, multi-agent coordination |
| Complex | Yes | 7 phases, dependency chains, parallel agents |

## Standard Tier Tasks

Create all tasks upfront after Phase 1 (Classify):

```
T1 = TaskCreate(subject="Analyze root cause",    activeForm="Analyzing root cause")
T2 = TaskCreate(subject="Scout related code",     activeForm="Scouting codebase")
T3 = TaskCreate(subject="Implement fix",          activeForm="Implementing fix",     addBlockedBy=[T1, T2])
T4 = TaskCreate(subject="Run tests",              activeForm="Running tests",        addBlockedBy=[T3])
T5 = TaskCreate(subject="Code review",            activeForm="Reviewing code",       addBlockedBy=[T4])
T6 = TaskCreate(subject="Commit",                 activeForm="Committing",           addBlockedBy=[T5])
```

## Complex Tier Tasks

```
T1 = TaskCreate(subject="Analyze root cause",       activeForm="Analyzing root cause")
T2 = TaskCreate(subject="Scout related code",        activeForm="Scouting codebase")
T3 = TaskCreate(subject="Brainstorm + research",     activeForm="Brainstorming",        addBlockedBy=[T1, T2])
T4 = TaskCreate(subject="Implement fix",             activeForm="Implementing fix",     addBlockedBy=[T3])
T5 = TaskCreate(subject="Run tests",                 activeForm="Running tests",        addBlockedBy=[T4])
T6 = TaskCreate(subject="Code review",               activeForm="Reviewing code",       addBlockedBy=[T5])
T7 = TaskCreate(subject="Commit",                    activeForm="Committing",           addBlockedBy=[T6])
```

**Note:** T1 and T2 run in parallel (analyze + scout simultaneously).

## Usage Pattern

```
TaskUpdate(taskId=T1, status="in_progress")
// ... do work ...
TaskUpdate(taskId=T1, status="completed")
// T3 auto-unblocks when T1 + T2 complete
```

## Rules

- Create tasks AFTER Phase 1 classify (need tier to decide task shape)
- Skip for Trivial tier
- Mark complete immediately after finishing
- If task fails → keep `in_progress`, fix issue, then complete
