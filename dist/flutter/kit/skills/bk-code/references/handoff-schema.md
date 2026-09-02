# Handoff Schema — Context Reset Pattern

Reference template for handoff docs written by `handoff-writer.cjs`.
Used when context >= 75% and complexity tier is `complex` or `architectural`.

## File Location
`mk/dev/shared/handoff/handoff-YYYYMMDD-HHMMSS.md`
Keep only latest 3. Older files auto-pruned.

## Schema

```md
# Handoff — <workflow-id>

## Mission
1-2 sentences describing the overall goal of this workflow.

## State
- Phase: coding|testing|review|planning
- Batch: N/total (e.g. 2/4)
- Complexity tier: complex|architectural
- Updated at: <ISO timestamp>

## Completed
- [x] Task or milestone already done
- [x] Another completed item

## Remaining
- [ ] Next task to execute
- [ ] Subsequent tasks

## Decisions (WHY)
- Why a particular approach was chosen
- Trade-offs accepted and reasoning

## File status
- `path/to/file.swift`: created|modified|pending
- `path/to/other.kt`: needs review

## Next agent instructions
1. Read this handoff doc first.
2. Read `mk/dev/shared/.workflow-state.json` for full state.
3. Continue from the Remaining tasks above.
4. Maintain the same complexity tier.
5. Do NOT restart completed tasks.
```

## Population Rules
- **Mission**: from `state.mission` or `state.description`; fallback: "Continue {workflowId} workflow."
- **Completed/Remaining**: from `state.completedTasks` / `state.remainingTasks` arrays
- **Decisions**: from `state.decisions` array
- **File status**: from `state.fileStatus` map `{ path: status }`
- Max handoff size: 400 lines (readable in one Read call)
