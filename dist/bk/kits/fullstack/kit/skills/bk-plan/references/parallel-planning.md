# Parallel Planning Reference

## Detection Algorithm

```
function detectParallelMode(features, flag):
  if flag == "--sequential": return SEQUENTIAL
  if flag == "--parallel": return PARALLEL

  units = extractIndependentUnits(features)
  # units = screens, endpoints, services, or top-level feature domains

  if len(units) < 3: return SEQUENTIAL

  # Independence check: units are independent if they share NO service layer
  independentCount = 0
  for each unit in units:
    deps = getSharedServices(unit, allUnits)
    if len(deps) == 0: independentCount++

  if independentCount >= 3: return PARALLEL
  return SEQUENTIAL  # tightly-coupled units -> sequential deps between them
```

## Independence Check

A unit (screen/feature/service) is **independent** if:
- No shared service class instantiation with another unit
- No shared ViewModel or state manager with another unit
- No shared navigation route registration that creates circular deps

A unit is **dependent** if:
- It calls a service also called by another unit (partial coupling — assign service to ONE phase)
- It extends or inherits from code in another unit
- Its data model is defined by another unit

**Rule:** Partial coupling does NOT prevent parallel — assign the shared file to ONE phase and list it in that phase's `owns:`. Other phases read it but do not modify it.

## Plan Frontmatter Schema

```yaml
---
execution: parallel   # parallel | sequential | auto
parallel_groups:
  - group: 1
    phases: [2, 3]    # these phases run concurrently
  - group: 2
    phases: [4]       # this phase runs after group 1
depends_on_all: [1]   # phases that must complete before any parallel group starts
---
```

## File Ownership Matrix

Add to `plan.md` after the sub-tasks table:

```markdown
## File Ownership Matrix

| Sub-Task | Owns (glob patterns) |
|----------|---------------------|
| sub-task-01-login | `Login/**`, `Auth/AuthService.*` |
| sub-task-02-dashboard | `Dashboard/**` |
| sub-task-03-settings | `Settings/**` |
| sub-task-04-tests | `**/Tests/**`, `**/Specs/**` |

**Shared file rule:** Each file appears in exactly ONE sub-task's `owns:`.
Files owned by a sub-task may be READ by other sub-tasks but NEVER modified.
```

## Dependency Graph Output

Write in `plan.md` under `## Execution Graph`:

```markdown
## Execution Graph

Phase 01 (login) → [sequential: auth dep]
Phase 02 (dashboard) ┐
Phase 03 (settings)  ├→ [parallel group]
                     ┘
Phase 04 (tests) → [sequential: depends on 01, 02, 03]

Parallel groups: {02, 03}
Sequential: 01 → {02, 03} → 04
```

## Parallel Group Rules

1. Phases within the same parallel group have no `addBlockedBy` relationship
2. A phase that depends on a parallel group lists ALL group phases in `addBlockedBy`
3. A phase that must run before any parallel group is listed as `sequential` in the graph
4. Test phases always run sequentially after all implementation phases
5. Shared file phases (e.g., router setup) run sequentially before groups that need those files

## Task Hydration for Parallel

When hydrating tasks (SKILL.md step 11):

```
For each phase in parallel group:
  TaskCreate(phase, addBlockedBy=[])   # no blockers within group

For each phase that depends on group:
  TaskCreate(phase, addBlockedBy=[phase_ids_in_group])

For sequential-before phases:
  TaskCreate(sub_task, addBlockedBy=[prior_sub_task_id])
```

Example (login→{dashboard,settings}→tests):
```
sub-task-01: addBlockedBy=[]
sub-task-02: addBlockedBy=[]          # parallel with 03
sub-task-03: addBlockedBy=[]          # parallel with 02
sub-task-04: addBlockedBy=[01, 02, 03]
```

## Anti-patterns to Avoid

- Do NOT create a parallel plan for < 3 independent units (overhead > benefit)
- Do NOT assign the same file to multiple phases (ownership violation)
- Do NOT create circular `addBlockedBy` chains
- Do NOT parallelize phases that share mutable state at runtime (e.g., same DB migration)
