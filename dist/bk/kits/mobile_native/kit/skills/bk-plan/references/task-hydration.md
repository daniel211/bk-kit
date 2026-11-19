# Task Hydration

Bridge plan files (persistent on disk) ↔ Claude Tasks (session-scoped in memory).

## Why

Plan files survive sessions. Claude Tasks die when session ends.
Tasks provide: dependency tracking (`addBlockedBy`), status management, `TaskList` to see what's ready.
Hydration pattern gives you both: persistence + real-time tracking.

## Hydrate: Checkboxes → TaskCreate

After plan files are written, for each `sub-task-NN-*.md` file:

1. Read the `## Tasks` section — and ONLY that section. `## Edge Cases & Risks` and
   `## Review Checklist` are plain bullets by design; if a sub-task file has checkboxes
   there, they are content, not tasks. Never hydrate them.
2. Each `- [ ]` line under `## Tasks` → 1 TaskCreate
3. Sub-task `depends` in YAML → `addBlockedBy` on first task of that sub-task
4. If a sub-task file has no `## Tasks` section:
   - Written by this `/bk-plan` run → the plan is malformed. Stop and report it rather than
     hydrating zero tasks silently; `plan-synthesis.md` requires the section.
   - A pre-existing plan from before 0.6.0 → hydrate one task for the whole sub-task and
     warn. Do not hydrate the checkboxes under `## Success Criteria` or `## Review Checklist`.
     Spec: `bk-code/references/plan-consumption.md` §Legacy plans. Sunset 0.8.0.

```
TaskCreate(
  subject: "{checkbox text}",
  activeForm: "{-ing form of checkbox text}",
  description: "Sub-task {NN}: {sub-task title}. See {sub-task-file-path}",
  metadata: { subTask: NN, planDir: "{plan-dir}", subTaskFile: "{filename}", reqs: ["{trace IDs}"] }
)
```

### Dependency Chain Example

```
sub-task-01 (no deps)         → Task A, Task B (no blockers)
sub-task-02 (depends: [01])   → Task C (addBlockedBy: [A])
sub-task-03 (depends: [01,02]) → Task D (addBlockedBy: [A, C])
```

Only block on first task of the dependency sub-task — when that completes,
the sub-task is "started" and subsequent tasks unblock naturally.

## 3-Sub-Task Rule

< 3 sub-tasks → skip hydration. Overhead exceeds benefit for tiny plans.

## State Integration

After hydration, update `.plan-state.json`:

```json
{
  "currentStep": 10,
  "completedSteps": [1, 2, 3, 4, 5, 6, 7, 8, 9],
  "hydration": {
    "taskCount": 15,
    "subTaskCount": 5,
    "taskIds": ["task-1", "task-2", "..."]
  }
}
```

See `handoff-protocol.md` for full state tracking spec.

## Sync-back: TaskUpdate → Checkboxes

When a task completes during bk-code execution:

1. `TaskUpdate(taskId, status: "completed")`
2. Edit the sub-task file's `## Tasks` section: `- [ ] {text}` → `- [x] {text}`
3. When ALL `## Tasks` checkboxes in a sub-task are checked:
   - Update sub-task YAML: `status: complete`
   - Update plan.md Sub-Tasks table: Status → Complete

## Cross-session Resume

See `handoff-protocol.md` → Resume Protocol for canonical spec.

Summary: new session → TaskList empty → read `.plan-state.json` + plan.md →
find incomplete sub-tasks → re-hydrate unchecked `## Tasks` items → continue.

## Quality Check After Hydration

Verify:
- No circular dependencies in the sub-task chain
- All sub-tasks have a `## Tasks` section with at least 1 task
- Task count matches unchecked `[ ]` items under `## Tasks` (not other sections)
- Output: `✓ Hydrated {N} tasks across {M} sub-tasks`
