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

Parse `$ARGUMENTS` for feature, platform and test type (unit / UI / device / all). Detect platform
from project files; load `config/platform-context.{platform}.json`.

Collect this feature's impl reports — markdown, one per implementation dispatch
(schema: `bk-agent-contract` §3). There is no `impl-result.json`.

```
Glob bk/dev/{feature}/research/impl-sub-task-*.md      # from /bk-code
Glob bk/dev/shared/reports/impl-{feature}-*.md         # from /bk-debug, /bk-refactor
```

Union their `files_changed` frontmatter → the surface under test.

IF no report matches: the feature was not implemented through a bk workflow, or the dev agent
returned without writing one. Do NOT infer scope from the feature name — say what is missing and
ask the user whether to test the working tree as-is (`git diff --name-only`) or stop.

**Foundation context:** read `bk/docs/foundation/architecture.md` (patterns, layer structure) and
`code-guidelines.md` (test patterns, naming), and include a summary in the test-architect prompt so
the strategy matches project conventions.

### Step 2: Test Strategy

Dispatch `bk-test-architect` foreground (sonnet) with the feature, platform and resolved impl
report paths; it must read each report's `files_changed` + `## Notes for Reviewer` before planning.
Output: `bk/dev/shared/reports/test-strategy-{feature}.json`. Read the strategy before Step 3.
Load: `references/test-dispatch.md`

### Step 3: Write and Run Tests

Dispatch test agents in ONE message (background, sonnet): `bk-unit-test-agent` always, plus
`bk-device-test-agent` when the feature has UI components or the user asks for device tests.
Load: `references/test-dispatch.md`

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

After each agent dispatch returns, check its output for reactive signals. Helper skills
dispatchable at any point: **bk-brainstormer** (stuck on approach / architecture concern),
**bk-docs-seeker** (unknown API or framework error), **bk-sequential-thinking** (complex
decomposition, conflicting data), **bk-problem-solving** (fix loops, breakthrough needed).

**Decision tables:** `rules/reactive-orchestration.md` — **User interaction:** `rules/user-interaction-protocol.md`
