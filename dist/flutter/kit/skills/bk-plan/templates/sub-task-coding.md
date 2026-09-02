# Sub-Task Template: Coding (Non-UI)

Use for: data models, services, utilities, API clients, storage layers, ViewModels, business logic.
Each sub-task = 1 focused unit (30-80 LOC). Not for screens/views — use sub-task-ui.md instead.

```markdown
---
sub-task: {NN}
title: "{Sub-Task Title}"
depends: [{dependency sub-task numbers}]
parallel-with: [{sub-tasks that can run concurrently}]
status: pending
effort: {Xh}
platform: {ios|android|flutter}
owns: ["{glob patterns for files this sub-task creates/modifies}"]
reqs: [{REQ-IDs this sub-task fulfills}]
---

# Sub-Task {NN}: {Title}

{One-line description.}

## Scope
- Create: {list new files}
- Modify: {list modified files with reason}
- LOC estimate: ~{N} lines

## Input References
- PRD: {section reference}
- API: {endpoint reference from inputs/api.json}
- Depends on: sub-task-{XX} output ({what it provides})

## Foundation References
<!-- Auto-filled from bk/docs/foundation/ during plan synthesis -->
- Architecture: {{foundation.architecture}}
- State Management: {{foundation.stateManagement}}
- Naming Convention: {{foundation.naming}}
- Test Pattern: {{foundation.testPattern}}
- Related Components: {{foundation.relatedComponents}}

## Existing Code

{Actual code snippets from files this sub-task will modify.
Show 5-15 lines per snippet with file path and line number.}

\```swift
// {FilePath.swift}:{line} — {what this code is}
{actual existing code}
\```

\```kotlin
// {FilePath.kt}:{line} — {what this code is}
{actual existing code}
\```

## Expected Code

### iOS

\```swift
// {path/NewFile.swift} — NEW
{expected code: structure, signatures, key logic}
{use existing patterns from Existing Code section}
\```

\```swift
// {path/ExistingFile.swift} — MODIFY (line {N}+)
{what to add/change}
\```

### Android

\```kotlin
// {path/NewFile.kt} — NEW
{expected code for Android}
\```

\```kotlin
// {path/ExistingFile.kt} — MODIFY (line {N}+)
{what to add/change}
\```

### Flutter

\```dart
// {path/new_file.dart} — NEW
{expected code for Flutter}
\```

_Include only platforms targeted by this sub-task. For Flutter: single section instead of iOS + Android._

## Edge Cases & Risks
- [ ] {edge case 1 — scenario + expected handling}
- [ ] {edge case 2 — scenario + expected handling}

## Success Criteria
- {verifiable criterion 1}
- {verifiable criterion 2}

## Test Plan (for this sub-task)

| Test | Type | Priority | Verifies |
|------|------|----------|----------|
| test_{method}_{scenario} | unit | P0 | {what it tests} |
| test_{method}_{edge_case} | unit | P1 | {edge case} |

_Test sub-tasks (05, 06) aggregate these test cases. bk-code executes them._

## Review Checklist
- [ ] Follows architecture pattern from Foundation References?
- [ ] Naming conventions match code-guidelines.md?
- [ ] Error handling complete (all failure paths covered)?
- [ ] No hardcoded values (URLs, keys, magic numbers)?
- [ ] File ownership: no overlap with other sub-tasks' `owns`?
- [ ] {sub-task specific check}

## Refs
- {REQ-ID}: {brief requirement text}
- Endpoint: {method} {path} (if API related)
- Pattern: {existing file}:{line}
```

## Guidelines

- Target 30-80 LOC expected output per sub-task; split if >100 LOC, merge if <20 LOC
- Max 3-5 files owned per sub-task
- Expected Code = preview spec, not full implementation
- Always reference existing patterns: "follows `File:line` pattern"
- Mark NEW vs MODIFY clearly
- `owns` in YAML = file ownership for parallel execution safety
- `reqs` links sub-task to requirements for traceability: `Requirement → Sub-Task → Test Case → Review`
- `depends` = sub-tasks that must complete before this one starts
- `parallel-with` = sub-tasks that can execute concurrently with this one
- Test Plan feeds into test sub-tasks (05, 06) for aggregation
- Review Checklist feeds into bk-code-reviewer dispatch prompt
- For Flutter: single code block instead of iOS + Android sections
