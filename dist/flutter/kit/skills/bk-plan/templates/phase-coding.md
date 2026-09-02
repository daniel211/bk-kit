# Phase Template: Coding (Non-UI)

Use for: data models, services, utilities, API clients, storage layers.

```markdown
---
phase: {N}
title: {Phase Title}
depends: [{dependency phase numbers}]
status: pending
platforms: [{platforms this phase targets}]
reqs: [{REQ-IDs this phase fulfills}]
owns: ["{glob patterns for files this phase creates/modifies}"]
---

# Phase {N}: {Phase Title}

{One-line description.}

## Foundation References
<!-- Auto-filled from mk/docs/foundation/ during plan synthesis -->
- Architecture: {{foundation.architecture}}
- State Management: {{foundation.stateManagement}}
- Naming Convention: {{foundation.naming}}
- Test Pattern: {{foundation.testPattern}}
- Related Components: {{foundation.relatedComponents}}

## Existing Code

{Actual code snippets from files this phase will modify.
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

## Tasks

- [ ] {atomic task 1}
- [ ] {atomic task 2}
- [ ] {atomic task 3}

## Done When

- {verifiable criterion 1}
- {verifiable criterion 2}

## Refs

- {REQ-ID}: {brief requirement text}
- Endpoint: {method} {path} (if API related)
- Pattern: {existing file}:{line}
```

## Guidelines

- Keep under 120 lines
- Expected Code = preview, not full implementation
- Always reference existing patterns: "follows `File:line` pattern"
- Mark NEW vs MODIFY clearly
- Tasks are `[ ]` checkboxes for hydration
- Done When = how to verify, not what was done
- For Flutter: single code block instead of iOS + Android sections
- `owns` in YAML = file ownership for parallel execution safety (deep mode required)
- `reqs` links tasks to requirements for traceability chain
