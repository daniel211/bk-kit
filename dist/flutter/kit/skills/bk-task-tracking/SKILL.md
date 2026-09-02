---
name: bk-task-tracking
description: "REQUIRED before dispatching agents. Provides plan JSON parsing, task status lifecycle, checkpoint structure, skill loading tracker, and resume protocol. Load at the start of any plan-driven workflow."
user-invocable: false
---

# Task Tracking Skill

> Load when needing plan parsing, task tracking, checkpoint management

---

## 1. IRON LAW

**"PLAN → AUTO TODO → DISPATCH ALL → COMPLETENESS GATE → COMMIT"**

---

## 2. PLAN JSON STRUCTURE (v2.2)

```json
{
  "plan_id": "{feature}-{uuid}",
  "version": "2.2",
  "tasks": [
    {
      "id": "task_id",
      "agent": "agent-name",
      "description": "Task description",
      "mandatory": true,
      "phase": "planning|development|testing|quality",
      "depends_on": [],
      "outputs": ["path/to/output"]
    }
  ],
  "skills_required": ["skill-name"],
  "research_files": {
    "requirements": "path|null",
    "design_specs": "path|null",
    "api_specs": "path|null",
    "spec_index": "path|null"
  },
  "post_tasks": {
    "agents": ["bk-unit-test-agent", "bk-code-reviewer"],
    "model": "sonnet",
    "skip": []
  },
  "learnings": []
}
```

### Learnings Flow

Dev agents may include `learnings[]` in impl-result.json. Main extracts and appends to plan JSON:

1. After dev agent returns, check impl-result.json for `learnings[]`
2. Infer `relevant_to_tasks` from dependency graph
3. Append to `plan.learnings[]` with `source_agent` and `task_id`
4. Include relevant learnings in next agent's dispatch prompt:

```
## LEARNINGS FROM PREVIOUS TASKS
- [gotcha] from T1 (agent): "description"
```

---

## 3. TASK STATUS LIFECYCLE

| Status | Meaning |
|--------|---------|
| pending | Not started |
| in_progress | Agent dispatched |
| complete | Outputs verified |
| skipped | User skipped |
| failed | Max retries exceeded |

---

## 4. PHASE ORDER

1. research
2. design
3. planning
4. **development** (main codes)
5. testing (background)
6. quality (background)
7. documentation
8. delivery

---

## 5. COMPLETENESS GATE

Before commit:
1. Filter mandatory tasks not complete/skipped
2. IF incomplete → BLOCK commit
3. Show options: Execute / Skip / Cancel

---

## 6. CHECKPOINT STRUCTURE (v5.0)

```json
{
  "checkpoint_version": "5.0",
  "session_id": "...",
  "timestamp": "ISO-8601",
  "feature": "...",
  "current_phase": "development",
  "plan_file": "...",
  "approval_status": "approved",
  "workflow_state": {
    "completed_phases": ["bootstrap"],
    "skills_loaded": ["skill-name"],
    "plan_tasks": [],
    "quality_fix_count": 0,
    "reanalysis_count": 0,
    "complexity_score": null,
    "complexity_tier": null
  },
  "verification_state": {
    "outputs_written": {},
    "agents_completed": []
  },
  "agent_trace": {"total_agents": 0, "completed": 0, "failed": 0},
  "interrupted": false,
  "recovery_hints": {
    "state_file": "mk/dev/shared/.workflow-state.json"
  }
}
```

Location: `mk/dev/checkpoints/checkpoint_{feature}_{timestamp}.json`

---

## 7. SKILL LOADING TRACKER

**Load skill ONCE per session, track in execution_state.skills_loaded[]**

```
BEFORE loading any skill:
  IF skill IN execution_state.skills_loaded → SKIP
  ELSE → Skill(name), add to skills_loaded

ON RESUME:
  Restore skills_loaded from checkpoint
  DO NOT call Skill() for skills already in list
```

RELOAD ONLY WHEN:
- Explicit user request: "reload skills"
- Skill NOT in skills_loaded yet

---

## 8. RESUME PROTOCOL

```
1. Load checkpoint
2. Verify approval state (plan file is SOURCE OF TRUTH)
3. Check background tasks: running/complete/failed/timeout
4. Resume interrupted agents: if agent_id present → Task(resume: agent_id)
   else re-dispatch from scratch
5. Log skills previously loaded (DON'T reload)
6. Continue from last step
```
