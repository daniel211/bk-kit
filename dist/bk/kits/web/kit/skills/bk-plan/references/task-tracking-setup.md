# Task Tracking Setup (bk-plan Step 2b)

Create tracking tasks for the agent-dispatch steps so the user sees progress.

```
# Conditional tasks based on mode and inputs:
IF inputs detected:
  T1 = TaskCreate(subject="Extract enterprise docs",    activeForm="Extracting docs")
  T2 = TaskCreate(subject="Extract design specs",       activeForm="Extracting design")
IF NOT fast mode:
  T3 = TaskCreate(subject="Research domain knowledge",  activeForm="Researching domain")
  T4 = TaskCreate(subject="Research platform patterns", activeForm="Researching platform")

# Core tasks (always):
T5 = TaskCreate(subject="Write implementation plan",    activeForm="Writing plan",     addBlockedBy=[T3?, T4?])
T6 = TaskCreate(subject="Critic review plan",           activeForm="Reviewing plan",   addBlockedBy=[T5])
T7 = TaskCreate(subject="Validate with user",           activeForm="Validating",       addBlockedBy=[T6])
T8 = TaskCreate(subject="Hydrate tasks for bk-code",    activeForm="Hydrating tasks",  addBlockedBy=[T7])
```

## Update protocol

- `TaskUpdate(taskId, status: "in_progress")` immediately **before** dispatching the agent.
- `TaskUpdate(taskId, status: "completed")` immediately **after** the agent returns.

Steps that carry a task id:

| Task | Step |
|------|------|
| T1 / T2 | Step 4 input processing (enterprise docs / design specs) |
| T3 / T4 | Step 6 research (bk-researcher ×2) |
| T5 | Step 8 synthesis (bk-planner) |
| T6 | Step 9 critic review (bk-code-reviewer) |
| T7 | Step 10 validate |
| T8 | Step 11 hydrate |
