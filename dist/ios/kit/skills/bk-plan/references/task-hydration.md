# Task Hydration

Bridge plan files (persistent on disk) ↔ Claude Tasks (session-scoped in memory).

## Why

Plan files survive sessions. Claude Tasks die when session ends.
Tasks provide: dependency tracking (`addBlockedBy`), status management, `TaskList` to see what's ready.
Hydration pattern gives you both: persistence + real-time tracking.

## Hydrate: Checkboxes → TaskCreate

After plan files are written, for each phase file:

1. Read `## Tasks` section
2. Each `- [ ]` line → 1 TaskCreate
3. Phase `depends` in YAML → `addBlockedBy` on first task of that phase

```
TaskCreate(
  subject: "{checkbox text}",
  activeForm: "{-ing form of checkbox text}",
  description: "Phase {N}: {phase title}. See {phase-file-path}",
  metadata: { phase: N, planDir: "{plan-dir}", phaseFile: "{filename}", reqs: ["{REQ-IDs}"] }
)
```

### Dependency Chain Example

```
Phase 1 (no deps)     → Task A, Task B (no blockers)
Phase 2 (depends: [1]) → Task C (addBlockedBy: [A])
Phase 3 (depends: [1,2]) → Task D (addBlockedBy: [A, C])
```

Only block on first task of dependency phase — when that completes,
the phase is "started" and subsequent tasks unblock naturally.

## 3-Phase Rule

< 3 phases → skip hydration. Overhead exceeds benefit for tiny plans.

## State Integration

After hydration, update `.plan-state.json`:

```json
{
  "currentStep": 10,
  "completedSteps": [1, 2, 3, 4, 5, 6, 7, 8, 9],
  "hydration": {
    "taskCount": 15,
    "phaseCount": 5,
    "taskIds": ["task-1", "task-2", "..."]
  }
}
```

See `handoff-protocol.md` for full state tracking spec.

## Sync-back: TaskUpdate → Checkboxes

When a task completes during bk-code execution:

1. `TaskUpdate(taskId, status: "completed")`
2. Edit phase file: `- [ ] {text}` → `- [x] {text}`
3. When ALL checkboxes in a phase are checked:
   - Update phase YAML: `status: complete`
   - Update plan.md phase table: Status → Complete

## Cross-session Resume

See `handoff-protocol.md` → Resume Protocol for canonical spec.

Summary: new session → TaskList empty → read `.plan-state.json` + plan.md →
find incomplete phases → re-hydrate unchecked `[ ]` items → continue.

## Quality Check After Hydration

Verify:
- No circular dependencies in phase chain
- All phases have at least 1 task
- Task count matches unchecked `[ ]` items
- Output: `✓ Hydrated {N} tasks across {M} phases`
