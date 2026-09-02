# Test Phase

Transition: `code → test`

**Skip for Trivial tier.**

## Dispatch Pattern

Dispatch ALL test agents in ONE message (background, sonnet):

### Standard

```
Task(subagent_type: "bk-unit-test-agent", model: "sonnet", run_in_background: true, prompt: "
  Feature: {feature}
  Platform: {platform}
  Files changed: {from impl-result.json}
  Test command: {from platform-context.json}
  Output: mk/dev/shared/reports/unit-test-{platform}-{feature}.md

  Run existing tests. Write new tests if gap found. Report pass/fail counts.
")
```

### Complex (additional)

```
Task(subagent_type: "bk-device-test-agent", model: "sonnet", run_in_background: true, prompt: "
  Feature: {feature}
  Platform: {platform}
  Device configs to test: {from platform-context.json}
  Output: mk/dev/shared/reports/device-test-{platform}-{feature}.md
")
```

## After Tests Return

1. Read test reports from `mk/dev/shared/reports/`
2. If all pass → proceed to review
3. If failures:
   - Resume dev agent: `Task(resume: dev_agent_id, prompt: "Test failures: {failures}")`
   - Re-run failed tests
   - Max 2 test-fix cycles, then escalate

## State Output

```json
{
  "current_phase": "test",
  "test_pass": true|false,
  "test_fix_count": 0
}
```
