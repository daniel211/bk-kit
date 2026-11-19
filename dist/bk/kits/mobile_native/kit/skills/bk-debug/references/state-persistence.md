# State Persistence & Compaction Recovery

## State File

Path: `bk/dev/shared/.workflow-state.json`

`workflow_type` (alias `command`) is what `fsm-guard.cjs` matches against the transition
table in `rules/state-machine.md`. Omit it and every transition passes unvalidated.

Phase changes after classify: `node .claude/cli/bk-health/index.cjs --set-phase <phase>` (add
`--inc quality_fix_count` on a review→code loop, `--field key=value` for the other fields a
phase writes) — `fsm-guard`'s validation and bookkeeping without a Read + Edit of this file.
The Edit path remains valid and guarded.

```json
{
  "workflow_type": "bk-debug",
  "command": "bk-debug",
  "current_phase": "classify|analyze|brainstorm|code|test|review|commit",
  "phase_history": [{"phase": "", "from_phase": "", "ts": 0, "entered_by": ""}],
  "phase_recurrence_count": {},
  "quality_fix_count": 0,
  "build_retry_count": 0,
  "test_fix_count": 0,
  "complexity_tier": "Trivial|Standard|Complex",
  "issue_type": "general|build|crash|device|perf",
  "review_mode": "auto|review|quick",
  "platform": "ios|android|flutter",
  "dev_agent_id": null,
  "reviewer_agent_id": null,
  "brainstorm_complete": false,
  "research_complete": false,
  "skills_loaded": [],
  "fix_guidance": null
}
```

## On Resume After Compaction

1. Read `current_phase` from `.workflow-state.json`
2. Resume from `current_phase` — do NOT re-execute completed phases
3. Check `quality_fix_count` before review→code transitions
4. Check `build_retry_count` before code retries
5. If `current_phase: "analyze"` — check if `debug-analysis-{feature}.json` exists
6. If `current_phase: "brainstorm"` — check if brainstorm/research reports exist
7. Restore `skills_loaded` — do NOT reload already-loaded skills
8. Verify `dev_agent_id` — if agent completed, read its output file

## Phase History

`phase_history[]` and `phase_recurrence_count{}` are appended by `fsm-guard.cjs` on every
accepted transition — read them, do not hand-maintain them:
```json
{"phase": "analyze", "from_phase": "classify", "ts": 1773556200000, "entered_by": "{session}"}
```

Provides audit trail and prevents re-execution of completed phases.

## Validation Before Transition

1. Read current phase from file
2. Check transition table in `rules/state-machine.md`
3. Verify transition is valid for current command
4. Verify required artifact exists (e.g. the impl report `bk/dev/shared/reports/impl-{feature}-debug.md` for code→test)
5. Write new phase (the guard appends to `phase_history[]`)
