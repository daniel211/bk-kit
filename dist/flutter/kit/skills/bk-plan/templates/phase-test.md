# Phase Template: Tests

Use for: test phases. Describe test cases, don't write test code.
Tester agent reads this + actual implemented code to write real tests.

```markdown
---
phase: {N}
title: Tests
depends: [{all implementation phase numbers}]
status: pending
platforms: [{platforms}]
reqs: [{all REQ-IDs covered by this plan}]
---

# Phase {N}: Tests

Test cases for {feature}. Tester agent reads this + implemented code to write tests.

## Foundation References
<!-- Auto-filled from mk/docs/foundation/ during plan synthesis -->
- Architecture: {{foundation.architecture}}
- State Management: {{foundation.stateManagement}}
- Naming Convention: {{foundation.naming}}
- Test Pattern: {{foundation.testPattern}}
- Related Components: {{foundation.relatedComponents}}

## Unit Tests

### {Component/Service Name 1}

| Case | Input | Expected | Priority |
|------|-------|----------|----------|
| {happy path} | {input} | {expected result} | P0 |
| {error path} | {input} | {expected error} | P0 |
| {validation} | {input} | {expected behavior} | P1 |

### {Component/Service Name 2}

| Case | Input | Expected | Priority |
|------|-------|----------|----------|
| {case} | {input} | {expected} | P0 |

## Integration Tests

| Case | Scope | Expected | Priority |
|------|-------|----------|----------|
| {end-to-end flow} | {components involved} | {expected outcome} | P0 |
| {navigation flow} | {screens involved} | {expected navigation} | P1 |
| {error recovery} | {components involved} | {expected recovery} | P0 |

## Edge Cases ⚠️

- [ ] {edge case 1 — describe scenario and expected behavior}
- [ ] {edge case 2}
- [ ] {edge case 3}

## Coverage

| Priority | Rule |
|----------|------|
| **P0** | Must pass before merge. Blocks completion. |
| **P1** | Should pass. Warn if missing, don't block. |
| **Edge cases** | Best effort. Document untested ones. |

## Notes for Tester

- {Mock strategy: which dependencies to mock, which to use real}
- {Special setup: test data, environment, fixtures}
- {Platform-specific: XCTest vs JUnit vs flutter_test patterns}
- {What can't be unit tested: OAuth flows, device-specific behavior}
```

## Guidelines

- NO test code in this template — only case descriptions
- Tables = structured, scannable format for tester agent
- P0 cases map to `must` priority requirements
- P1 cases map to `should` priority requirements
- Edge Cases use `[ ]` checkboxes — tester checks off as covered
- Notes for Tester = practical guidance, not theory
- Keep under 80 lines — if more cases needed, split into unit + integration phases
