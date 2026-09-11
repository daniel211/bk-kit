# Quality Loop (Steps 4-5)

Code review first, then test — so tests validate final reviewed/fixed code.

## Mode Skip Conditions

| Mode | Step 4 (Review) | Step 5 (Test) |
|------|-----------------|---------------|
| full | Run | Run |
| fast | **Skip** | **Skip** |
| no-review | **Skip** | Run |

If skipping all: log `"Quality loop skipped (fast mode)"` and proceed to Step 6.

## Step 4: Code Review (Parallel Multi-Focus)

Dispatch 3 focused reviewers in a **single message** (parallel execution):

```
# All 3 dispatched in ONE message — not sequentially
Task(subagent_type: "bk-code-reviewer", model: "sonnet", run_in_background: true, description: "Review architecture", prompt: "
  Review changes for plan: {plan-dir}
  Phase files: {list of completed phase files}
  Platform context: platform-context.json

  FOCUS: Architecture + Code Quality
  Check: architecture compliance, naming conventions, file size (<200 LOC),
  platform conventions, error handling, localization (no hardcoded text).
  If plan has 'owns' fields: verify no files edited outside ownership scope.
  Flag overly complex code that could be simplified (KISS/DRY violations).

  Before returning: verify report file exists and is non-empty.
  Output: score (1-10), critical issues, warnings, info.
  Save report to: {plan-dir}/research/review-architecture.md
")

Task(subagent_type: "bk-code-reviewer", model: "sonnet", run_in_background: true, description: "Review security", prompt: "
  Review changes for plan: {plan-dir}
  Phase files: {list of completed phase files}
  Platform context: platform-context.json

  FOCUS: Security
  Check: hardcoded secrets, token storage, input validation, OWASP top 10,
  auth patterns, data exposure, insecure network calls.

  Before returning: verify report file exists and is non-empty.
  Output: score (1-10), critical issues, warnings.
  Save report to: {plan-dir}/research/review-security.md
")

Task(subagent_type: "bk-code-reviewer", model: "sonnet", run_in_background: true, description: "Review reqs coverage", prompt: "
  Review changes for plan: {plan-dir}
  Phase files: {list of completed phase files}
  Platform context: platform-context.json

  FOCUS: Requirements + SRS Traceability
  If plan has 'reqs' fields: cross-check each req ID has matching implementation.
  Reference: {plan-dir}/srs.md for acceptance criteria (if exists).
  Check test coverage plan matches requirements.

  Before returning: verify report file exists and is non-empty.
  Output: reqs coverage %, gaps list, recommendations.
  Save report to: {plan-dir}/research/review-requirements.md
")
```

### Merge findings

After all 3 reviewers complete:
1. Read all 3 review reports
2. Aggregate: worst score = overall score, merge all critical issues
3. If ANY critical issues → proceed to fix loop

### Fix loop

If critical issues found:
1. Resume `bk-{platform}-developer` agent with merged findings from all reviewers
2. Re-run ONLY the reviewer(s) whose focus area had critical issues
3. Max 2 fix iterations
4. After 2 failures: escalate to user via `AskUserQuestion` tool with options: "Fix manually" / "Skip review" / "Abort"

## Step 5: Test

### Dispatch tester

After review + fixes complete, dispatch tester with test phase file:

```
Task(subagent_type: "bk-unit-test-agent", model: "sonnet", run_in_background: true, description: "Run tests", prompt: "
  Task: Write and run unit/integration tests from the test phase file
  Test phase file: {path-to-test-phase-file}
  Implemented code: {list of files changed in completed phases}
  Platform context: platform-context.json

  Read ## Unit Tests, ## Integration Tests tables, ## Edge Cases, and ## Notes for Tester.
  Each row = 1 test case. Write real test code using descriptions as spec.
  P0 = must pass. P1 = should pass. Edge cases = best effort.
  Do NOT mock excessively — use real fakes/in-memory implementations.
  Before returning: verify all test files exist and test results are reported.
  Output: test files created + pass/fail summary per case
")
```

### Failure handling

If tests fail:
1. Dispatch `bk-debugger` agent with failure output
2. Apply fixes from debugger
3. Re-run tests (max 3 cycles)
4. After 3 failures: escalate to user via `AskUserQuestion` tool with diagnostics and options: "Fix manually" / "Skip failing tests" / "Abort"

### Priority rules

| Priority | Rule |
|----------|------|
| **P0** | Must pass. Blocks completion. |
| **P1** | Should pass. Warn if skip, don't block. |
| **Edge** | Best effort. Document untested ones. |

### Quality gate (all must pass)

- [ ] No critical issues from any reviewer (or fixed)
- [ ] All P0 tests pass
- [ ] Build succeeds on target platform
- [ ] No files edited outside `owns` scope (if declared)
- [ ] Requirements coverage: all req IDs in phase YAML have implementation (if declared)

Gate failure after max retries → **use `AskUserQuestion` tool**:
```json
{
  "questions": [{
    "question": "Quality gate failed after max retries. How to proceed?",
    "header": "Quality Gate Failure",
    "options": [
      { "label": "Fix manually", "description": "I'll fix the issues myself" },
      { "label": "Skip quality gate", "description": "Proceed despite failures" },
      { "label": "Abort", "description": "Stop workflow" }
    ]
  }]
}
```
