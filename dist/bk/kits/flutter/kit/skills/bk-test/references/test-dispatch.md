# Test Agent Dispatch (bk-test Steps 2–3)

### Step 2: Test Strategy

Dispatch bk-test-architect foreground (sonnet):
```
Task(subagent_type: "bk-test-architect", prompt: "
  Feature: {feature_name}
  Platform: {platform}
  Impl reports: {list of resolved report paths from Step 1}
  Read each report's `files_changed` + `## Notes for Reviewer` before planning strategy.
  Output: bk/dev/shared/reports/test-strategy-{feature}.json
")
```

Read strategy output before dispatching test agents.

### Step 3: Write and Run Tests

Dispatch test agents background (sonnet), all in ONE message:

```
# Always — unit tests:
Task(subagent_type: "bk-unit-test-agent", model: "sonnet", run_in_background: true, prompt: "
  Feature: {feature_name}
  Platform: {platform}
  Test strategy: bk/dev/shared/reports/test-strategy-{feature}.json
  Output: bk/dev/shared/reports/unit-test-{platform}-{feature}.json
")

# Optional — when feature has UI components or user requests device tests:
Task(subagent_type: "bk-device-test-agent", model: "sonnet", run_in_background: true, prompt: "
  Feature: {feature_name}
  Platform: {platform}
  Output: bk/dev/shared/reports/device-test-{platform}-{feature}.json
")
```
