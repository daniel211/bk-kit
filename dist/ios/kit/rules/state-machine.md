---
paths:
  - mk/dev/shared/.workflow-state.json
  - mk/dev/**
---

# Workflow State Machine

> Enforces valid phase transitions for FSM commands. Prevents phase-skipping after compaction.

---

## `/bk-code` Transitions

```
(none) → plan → coding → testing → review → [fix-loop max 2] → commit
                  ↑                   ↓
                  └── review ─────────┘ (fix loop)
```

| From | To | Required Artifact |
|------|----|-------------------|
| (none) | plan | — |
| plan | coding | Plan approved, skills loaded |
| coding | testing | `impl-result.json` exists |
| testing | review | Test agents complete |
| review | commit | All post-tasks complete |
| review | coding | Fix loop: `quality_fix_count < 2` AND critical/major findings |

### Complexity Routing

| Tier | Pipeline | Post-tasks |
|------|----------|-----------|
| Trivial | plan → code → commit | None |
| Standard | Full pipeline | bk-code-reviewer + bk-unit-test-agent |
| Complex | Full pipeline | bk-code-reviewer + bk-security-auditor + bk-performance-analyzer + bk-unit-test-agent + bk-device-test-agent |

---

## `/bk-debug` Transitions

```
(none) → classify → [analyze] → [brainstorm] → code → test → [review] → commit
              ↓                                   ↑
          code → commit  (Trivial shortcut)      |
                                                  |
              analyze → brainstorm (Complex only)─┘
```

| From | To | Required Artifact | Condition |
|------|----|-------------------|-----------|
| (none) | classify | — | — |
| classify | analyze | — | Complexity: Standard/Complex |
| classify | code | — | Complexity: Trivial (skip analyze) |
| analyze | code | Root cause identified | Complexity: Standard |
| analyze | brainstorm | Root cause identified | Complexity: Complex |
| brainstorm | code | Brainstorm + research reports | Complexity: Complex |
| code | test | Fix applied, `impl-result.json` exists | — |
| test | review | Test agents complete | Standard/Complex |
| test | commit | — | Trivial — skip review |
| review | commit | Post-tasks complete | — |
| review | code | Critical findings | Fix loop: mode-aware max cycles |

### Review Mode Fix Loop Limits

| Mode | Max Cycles | Auto-approve Threshold |
|------|------------|----------------------|
| `--auto` | 2 | score >= 9.5, critical == 0 |
| `--review` | 2 | Never (always ask user) |
| `--quick` | 1 | score >= 8.5, critical == 0 |

---

## `/bk-refactor` Transitions

```
(none) → analyze → refactor → test → [fix-loop max 1] → commit
                     ↑                      ↓
                     └── test ──────────────┘ (1 retry only)
```

| From | To | Required Artifact |
|------|----|-------------------|
| (none) | analyze | — |
| analyze | refactor | Refactoring scope identified |
| refactor | test | `impl-result.json` exists |
| test | commit | Tests pass |
| test | refactor | Fix loop: `refactor_fix_count < 1` AND tests fail |

Fix-loop max 1: 1 automatic retry, then escalate to user.

---

## State Persistence

File: `mk/dev/shared/.workflow-state.json`

```json
{
  "command": "bk-code|bk-debug|bk-refactor",
  "feature": "feature-name-slug",
  "current_phase": "plan|coding|testing|review|commit|escalated|aborted|classify|analyze|brainstorm",
  "phase_history": [{"from": "", "to": "", "timestamp": ""}],
  "quality_fix_count": 0,
  "build_retry_count": 0,
  "test_fix_count": 0,
  "refactor_fix_count": 0,
  "complexity_tier": "Trivial|Standard|Complex",
  "issue_type": "general|build|crash|device|perf",
  "review_mode": "auto|review|quick",
  "dev_agent_id": null,
  "reviewer_agent_id": null,
  "brainstorm_complete": false,
  "research_complete": false,
  "skills_loaded": [],
  "platform": "ios|android|flutter",
  "fix_guidance": null
}
```

---

## Terminal & Error States

| State | Type | Description |
|-------|------|-------------|
| `commit` | Terminal (success) | Feature committed successfully |
| `escalated` | Terminal (pending) | Fix-loop max exceeded — awaiting user decision |
| `aborted` | Terminal (failure) | User chose to discard work |

### Escalation Transitions

| From | To | Condition |
|------|----|-----------|
| review | escalated | `quality_fix_count >= max` AND critical findings remain |
| test | escalated | `test_fix_count >= max` AND tests still fail |
| escalated | commit | User chooses "commit as-is" |
| escalated | aborted | User chooses "abort/discard" |
| escalated | coding | User provides manual fix guidance |

---

## Fix Loop Rules

- Resume dev agent via `Task(resume: dev_agent_id)` with review findings.
- After fixes: selective re-dispatch only affected review agents.
- On max reached, transition to `escalated`: "Fix loop limit. Options: 1) Force continue, 2) Commit as-is, 3) Abort"

---

## On Resume After Compaction

1. Read `current_phase` and `phase_history[]` from `.workflow-state.json`
2. Resume from `current_phase` — do not re-execute completed phases
3. Check fix-loop counters before quality→coding transitions
4. Verify artifacts exist before proceeding

---

## Validation

Before writing `current_phase`:
1. Read current phase from file
2. Check transition table for current command
3. Verify transition is valid
4. Verify required artifact exists
5. Append to `phase_history[]`

Phase re-entry 3+ times triggers `[REACTIVE-SIGNAL: fix_loop_stuck]`. See `reactive-orchestration.md`.
