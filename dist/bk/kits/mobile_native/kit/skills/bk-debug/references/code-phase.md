# Code Phase

Transition: `analyze → code` (or `classify → code` for Trivial)

## ALL Tiers (including Trivial)

ALWAYS dispatch platform dev agent. DO NOT fix code yourself.
Trivial: simplified prompt, skip analyze context. Standard/Complex: full context.

Dispatch platform dev agent foreground (opus):

```
Task(subagent_type: "bk-{platform}-developer", prompt: "
  Fix plan from debug analysis
  Root cause: {root_cause}
  Files to modify: {affected_files}
  Fix approach: {fix_approach}
  Platform context: {from platform-context.json}
  Output: bk/dev/shared/reports/impl-{feature}-debug.md
    (impl report — markdown + YAML frontmatter, schema in bk-agent-contract §3)

  Requirements:
  - Follow platform conventions from {platform}-rules.md
  - Verify build after changes; set build_verified only if the build actually ran
  - List every changed file in the report's files_changed frontmatter
  - If blocked: still write the report with status: needs_info + info_needed
")
```

## After Agent Returns

1. Verify `bk/dev/shared/reports/impl-{feature}-debug.md` exists with `files_changed` (min 1)
2. If build errors: resume via `Task(resume: dev_agent_id)`, max 3 retries
3. Write `dev_agent_id` to `.workflow-state.json`

## Build Error Retry

```
build_retry_count = 0
LOOP:
  IF build passes → PROCEED to test
  IF build_retry_count >= 3 → ESCALATE to user
  ELSE:
    Task(resume: dev_agent_id, prompt: "Build error: {error}. Fix and re-verify.")
    build_retry_count++
    GOTO LOOP
```

## State Output

```json
{
  "current_phase": "code",
  "dev_agent_id": "{agent_id}",
  "build_retry_count": 0
}
```
