---
name: bk-test
description: "Test workflow — dispatch bk-test-architect for strategy, bk-unit-test-agent to write and run tests, optional device tests."
user-invocable: true
argument-hint: "[feature or scope to test]"
---

# Test: $ARGUMENTS

Dispatches bk-test-architect to define strategy, then bk-unit-test-agent to write and run tests.
Optionally dispatches bk-device-test-agent for UI/device-level testing. No code changes — test-only.

<Use_When>
- User wants to write or run tests for a feature
- User says "test", "write tests", "add tests", "verify", "check coverage"
- After implementation, before review or commit
- User invokes `/bk-test [feature or scope]`
</Use_When>

<Do_Not_Use_When>
- Implementation needed first — use /bk-code
- Code review only — use /bk-review
</Do_Not_Use_When>

## Approval Gates

Auto-approve — no user gate required.

## Execution

### Step 1: Resolve Scope

Parse `$ARGUMENTS` for feature name, platform, and test type (unit / UI / device / all).
Detect platform from project files. Load platform context from `config/platform-context.{platform}.json`.

Collect the impl reports for this feature — markdown, one per implementation dispatch
(schema: `bk-agent-contract` §3). There is no `impl-result.json`.

```
Glob bk/dev/{feature}/research/impl-sub-task-*.md      # from /bk-code
Glob bk/dev/shared/reports/impl-{feature}-*.md         # from /bk-debug, /bk-refactor
```

Union their `files_changed` frontmatter → the surface under test.

IF no report matches: the feature has not been implemented through a bk workflow, or the
dev agent returned without writing one. Do NOT infer scope from the feature name — say what
is missing and ask the user whether to test the working tree as-is (`git diff --name-only`)
or stop.

### Foundation Context Loading
Before dispatching the test-architect agent:
1. Read `bk/docs/foundation/architecture.md` — extract architecture patterns, layer structure
2. Read `bk/docs/foundation/code-guidelines.md` — extract test patterns, naming conventions
3. Include foundation summary in test-architect dispatch prompt to ensure test strategy aligns with project conventions

### Step 2: Test Strategy

Dispatch bk-test-architect foreground (sonnet):
```
Task(subagent_type: "bk-test-architect", model: "sonnet", prompt: "
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

### Step 4: Collect Results

Show summary to user:
- Tests written: N
- Tests passing: N / total
- Coverage: N%
- Failures with actionable next steps

If failures exist: suggest `/bk-debug` for bugs or `/bk-code` for missing implementation.

## Output

- `bk/dev/shared/reports/test-strategy-{feature}.json`
- `bk/dev/shared/reports/unit-test-{platform}-{feature}.json`
- `bk/dev/shared/reports/device-test-{platform}-{feature}.json` (optional)

## Constraints

- bk-test-architect runs first (foreground), test agents run in parallel (background)
- Unit test agent writes AND runs tests
- Device test agent writes tests only — main session runs device commands
- Single-message batching: dispatch ALL test agents in ONE message
- Tool restrictions: `rules/agent-protocols/tool-restriction.md`

## Reactive Orchestration Reminder

This skill operates within the reactive orchestration framework.
After each agent dispatch and return, check output for reactive signals.

**Helper skills available for dispatch at any point in this workflow:**
- **bk-brainstormer** — agent stuck on approach, architecture concern
- **bk-docs-seeker** — unknown API/framework error
- **bk-sequential-thinking** — complex decomposition, conflicting data
- **bk-problem-solving** — creative breakthrough needed, fix loops

**Decision tables:** `rules/reactive-orchestration.md`
**User interaction:** `rules/user-interaction-protocol.md`
