# State Persistence & Compaction Recovery

## State File

Path: `mk/dev/shared/.workflow-state.json`

```json
{
  "command": "bk-debug",
  "current_phase": "classify|analyze|brainstorm|code|test|review|commit",
  "phase_history": [{"from": "", "to": "", "timestamp": ""}],
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

Append to `phase_history[]` on every transition:
```json
{"from": "classify", "to": "analyze", "timestamp": "2026-03-15T06:30:00Z"}
```

Provides audit trail and prevents re-execution of completed phases.

## Validation Before Transition

1. Read current phase from file
2. Check transition table in `rules/state-machine.md`
3. Verify transition is valid for current command
4. Verify required artifact exists (e.g., `impl-result.json` for code→test)
5. Write new phase + append to `phase_history[]`
