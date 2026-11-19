# Workflow Completion Report (bk-agent-contract §8)

Path: `bk/dev/shared/reports/workflow-report-{feature}.json`

```json
{
  "report_version": "1.0",
  "feature": "{name}",
  "generated_at": "ISO-8601",
  "summary": {
    "status": "SUCCESS|PARTIAL|FAILED",
    "tasks": {"total": 8, "completed": 8, "skipped": 0}
  },
  "files_changed": {
    "total": 5,
    "list": [{"path": "...", "change": "modified", "description": "..."}]
  },
  "test_results": {
    "unit": {"total": 10, "passed": 10, "failed": 0},
    "gate_status": "PASSED"
  },
  "review_summary": {
    "status": "approved|rejected",
    "issues_found": 2,
    "issues_fixed": 2
  },
  "impact_assessment": {
    "scope": "low|medium|high",
    "risk_level": "low"
  }
}
```

### Generate Logic

```
1. Read every impl report for the feature → union of `files_changed`
2. Read test-execution-*.json → test_results
3. Read code-review-*.json → review_summary
4. Calculate impact from impl data
5. Write workflow-report-{feature}.json
6. Display summary to user
```
