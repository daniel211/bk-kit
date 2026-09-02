# Metrics Collection

## Purpose
Track agent performance across workflows to enable data-driven optimization of dispatch strategies, timeout tuning, and model routing.

## Collection Protocol

After each skill completes, the conductor SHOULD write a metrics file:

**Path:** `mk/dev/shared/metrics/{skill}-{feature}-{YYMMDD}.json`

**Schema:**
```json
{
  "skill": "bk-code",
  "feature": "payment-qr",
  "tier": "Standard",
  "timestamp": "2025-01-15T10:30:00Z",
  "duration_ms": 180000,
  "agents_dispatched": [
    {"agent": "bk-planner", "model": "opus", "duration_ms": 45000, "status": "completed"},
    {"agent": "bk-ios-developer", "model": "sonnet", "duration_ms": 120000, "status": "completed"},
    {"agent": "bk-code-reviewer", "model": "sonnet", "duration_ms": 30000, "status": "completed"}
  ],
  "phases_total": 3,
  "phases_completed": 3,
  "fix_cycles": 0,
  "build_retries": 1,
  "review_verdict": "approve",
  "review_stats": {
    "critical": 0,
    "warning": 1,
    "info": 3
  },
  "outcome": "success"
}
```

## When to Collect

| Skill | Trigger |
|-------|---------|
| bk-code | After commit phase completes |
| bk-debug | After fix verified or escalated |
| bk-plan | After plan approved |
| bk-bootstrap | After synthesis complete |
| bk-review | After review verdict delivered |
| bk-test | After test execution complete |

## Usage

Metrics files accumulate over time and can be used to:
- Identify slow agents (optimize prompts or model routing)
- Track fix cycle frequency (improve plan quality)
- Measure parallel vs sequential execution gains
- Compare agent performance across features

## Privacy
- Never include file contents or code snippets in metrics
- Only include: timing, agent names, models, counts, verdicts
