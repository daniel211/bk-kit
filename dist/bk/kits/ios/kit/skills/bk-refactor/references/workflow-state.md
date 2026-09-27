# Workflow State (bk-refactor)

File: `bk/dev/shared/.workflow-state.json`

`workflow_type` (alias `command`) is what `fsm-guard.cjs` matches against the transition table in
`rules/state-machine.md`. Omit it and every transition passes unvalidated.
`phase_history[]` / `phase_recurrence_count{}` are appended by the guard — read, don't write.
Phase changes: `node .claude/cli/bk-health/index.cjs --set-phase <phase>` (`--inc refactor_fix_count` on a
test→refactor loop) — validated like an Edit, no Read of this file needed; Edit is the fallback.

```json
{
  "workflow_type": "bk-refactor",
  "command": "bk-refactor",
  "current_phase": "analyze|refactor|test|commit",
  "phase_history": [{"phase": "", "from_phase": "", "ts": 0, "entered_by": ""}],
  "phase_recurrence_count": {},
  "refactor_fix_count": 0,
  "refactor_type": "rename|extract|move|restructure|modernize",
  "complexity_tier": "Trivial|Standard|Complex",
  "platform": "ios|android|flutter",
  "dev_agent_id": null,
  "affected_files": []
}
```

Phase 1 also writes `refactor_type`, `affected_files`, `complexity_tier`, `platform` once scope is
identified.

## On resume after compaction

1. Read `current_phase` from `.workflow-state.json`
2. Resume from `current_phase` — do not re-execute completed phases
3. Check `refactor_fix_count` before any test→refactor transition
4. If `current_phase: "refactor"` — check whether
   `bk/dev/shared/reports/impl-{feature}-refactor.md` already exists (the dev agent may have
   finished before compaction)
