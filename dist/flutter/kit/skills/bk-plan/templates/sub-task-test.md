# Sub-Task Template: Tests

Use for: dedicated test sub-tasks that aggregate test cases from coding/UI sub-tasks.
Tester agent reads this + actual implemented code to write real tests.
Test sub-tasks can often run in parallel with UI sub-tasks (when ViewModel is ready).

```markdown
---
sub-task: {NN}
title: "Unit Tests — {scope}"
depends: [{sub-tasks that provide code to test}]
parallel-with: [{UI sub-tasks — tests can run parallel with UI}]
status: pending
effort: {Xh}
platform: {ios|android|flutter}
owns: ["{test file glob patterns}"]
---

# Sub-Task {NN}: Unit Tests — {scope}

Test cases for {scope}. Tester agent reads this + implemented code to write tests.

## Foundation References
<!-- Auto-filled from bk/docs/foundation/ during plan synthesis -->
- Architecture: {{foundation.architecture}}
- Test Pattern: {{foundation.testPattern}}
- Related Components: {{foundation.relatedComponents}}

## Test Cases (aggregated from dependent sub-tasks)

### From sub-task-{XX} ({title}):

| Test | Type | Priority | Input | Expected |
|------|------|----------|-------|----------|
| test_{method}_{scenario} | unit | P0 | {setup/input} | {expected assertion} |
| test_{method}_{edge_case} | unit | P1 | {setup/input} | {expected assertion} |

### From sub-task-{YY} ({title}):

| Test | Type | Priority | Input | Expected |
|------|------|----------|-------|----------|
| test_{method}_{scenario} | unit | P0 | {setup/input} | {expected assertion} |
| test_{method}_{edge_case} | unit | P1 | {setup/input} | {expected assertion} |

## Integration Tests

| Test | Scope | Priority | Input | Expected |
|------|-------|----------|-------|----------|
| test_{end_to_end_flow} | {components involved} | P0 | {setup} | {expected outcome} |
| test_{navigation_flow} | {screens involved} | P1 | {setup} | {expected navigation} |
| test_{error_recovery} | {components involved} | P0 | {setup} | {expected recovery} |

## Edge Cases

- [ ] {edge case 1 — scenario + expected behavior}
- [ ] {edge case 2 — scenario + expected behavior}
- [ ] {edge case 3 — scenario + expected behavior}

## Test Strategy
- **Mock**: {what to mock — repositories, network clients, platform APIs}
- **Real**: {what to test with real implementations — pure logic, mappers, validators}
- **Coverage target**: >80% for business logic files in scope
- **Framework**: {XCTest | JUnit/Mockito | flutter_test/mockito}

## Success Criteria
- All P0 tests pass
- All P1 tests pass
- Coverage > 80% for files owned by dependent sub-tasks
- No flaky tests (deterministic, no timing dependencies)

## Coverage Matrix

| Priority | Rule |
|----------|------|
| **P0** | Must pass before merge. Blocks batch completion. |
| **P1** | Should pass. Warn if missing, don't block. |
| **Edge cases** | Best effort. Document untested ones. |

## Notes for Tester
- {Mock strategy: which dependencies to mock, which to use real}
- {Special setup: test data, environment, fixtures}
- {Platform-specific: XCTest vs JUnit vs flutter_test patterns}
- {What can't be unit tested: OAuth flows, device-specific behavior}

## Review Checklist
- [ ] All P0 test cases from dependent sub-tasks covered?
- [ ] All P1 test cases from dependent sub-tasks covered?
- [ ] Edge cases documented (tested or noted as untested)?
- [ ] Mocks follow Foundation References test patterns?
- [ ] No flaky tests (deterministic, no sleep/delay)?
- [ ] Coverage > 80% for business logic in scope?
```

## Guidelines

- NO test code in this template — only case descriptions with inputs + expected outputs
- Tables = structured, scannable format for tester agent
- Test cases are aggregated from `## Test Plan` sections of dependent coding/UI sub-tasks
- P0 cases map to `must` priority requirements; P1 to `should`
- Edge Cases use `[ ]` checkboxes — tester checks off as covered
- `parallel-with` often includes UI sub-tasks (tests can run while UI is built)
- `depends` = the coding sub-tasks whose code is being tested
- `owns` = test file patterns only (no overlap with implementation sub-tasks)
- Keep under 80 lines — if more cases, split into unit + integration test sub-tasks
- Notes for Tester = practical guidance, not theory
- bk-code dispatches bk-unit-test-agent with this sub-task as input
