# plan.md Template

Use this structure when generating `plan.md` for a feature.

```markdown
---
title: "{Feature Title}"
feature: {kebab-case-name}
platforms: [{ios|android|flutter}]
mode: {fast|deep}
triage: {small|normal|large|massive}
scope: {milestone-N|full}
status: pending
approval: pending
priority: {P0|P1|P2|P3}
effort: {hours|days|weeks}
branch: "{feature-branch-name or empty}"
tags: [{comma-separated-tags}]
created: {YYYY-MM-DD}
---

# {Feature Title}

{One-line description of what this feature does.}

## Inputs

| Source | File |
|--------|------|
| Figma | `inputs/design.json` ({screen names}) |
| OpenAPI | `inputs/api.json` ({N} endpoints, {N} models) |
| Docs | `inputs/requirements.json` ({N} requirements) |

_Remove rows for sources not provided. If no inputs, remove this section._

## Code Impact

- **Modify**: {file list with brief reason}
- **New**: {count} files ({brief list})
- **Blast radius**: {what else is affected}
- **Patterns**: {detected architecture, async, DI patterns}

## Sub-Tasks

| # | Sub-Task | Depends | Parallel | Effort | Status |
|---|----------|---------|----------|--------|--------|
| 00 | [{sub-task title}][st00] | — | — | {Xh} | Pending |
| 01 | [{sub-task title}][st01] | 00 | — | {Xh} | Pending |
| 02 | [{sub-task title}][st02] | 00, 01 | — | {Xh} | Pending |
| 03 | [{sub-task title}][st03] | 02 | 05 | {Xh} | Pending |
| 04 | [{sub-task title}][st04] | 03 | — | {Xh} | Pending |
| 05 | [{sub-task title}][st05] | 02 | 03 | {Xh} | Pending |
| 06 | [{sub-task title}][st06] | all | — | {Xh} | Pending |

## Dependency Graph

```
{ASCII dependency visualization}

Example:
  00 (Data models)
   │
  01 (Repository)
   │
  02 (ViewModel)
   ├───────┐
  03 (UI)   05 (Tests)   ← parallel
   │
  04 (Navigation)
   │
  06 (Integration tests)
```

## Execution Batches (for bk-code)

| Batch | Sub-Tasks | After Implement | After Review |
|-------|-----------|----------------|--------------|
| 1: Data | 00, 01 | Run sub-task-00,01 tests | Batch review: API + data |
| 2: Logic+UI | 02, 03, 05 | Run sub-task-05 tests | Batch review: logic + UI + Figma |
| 3: Integration | 04, 06 | Run sub-task-06 tests | Final review |

## Test Strategy Summary

- Unit tests: {count} (from sub-task test plans)
- Integration tests: {count}
- Snapshot tests: {count} (UI sub-tasks)
- Coverage target: >80% for business logic
- Mock strategy: {repositories, network clients}

## Review Strategy Summary

- Batch 1 review: architecture, API integration, data mapping
- Batch 2 review: business logic, UI/Figma match, accessibility, security
- Batch 3 review: end-to-end flow, edge cases, navigation

## Gaps

- {gap description} — {assumption or decision taken} ({severity})

## Critic Review

_Populated by dispatched critic agent. Remove if fast mode._

## Validation Log

_Populated by validate-interview step. Remove if fast mode._

---
Next: `/bk-code {plan-dir}/plan.md`

[st00]: ./sub-task-00-{name}.md
[st01]: ./sub-task-01-{name}.md
[st02]: ./sub-task-02-{name}.md
[st03]: ./sub-task-03-{name}.md
[st04]: ./sub-task-04-{name}.md
[st05]: ./sub-task-05-{name}.md
[st06]: ./sub-task-06-{name}.md
```

## Guidelines

- Keep under 80 lines (expanded from 60 to accommodate batches + test/review strategy)
- YAML frontmatter is source of truth for status tracking and plan metadata
- `title` = human-readable feature title
- `priority` = P0 (critical) to P3 (nice-to-have), derived from triage
- `effort` = estimated effort (hours/days/weeks), derived from triage scope
- `branch` = git branch name if known, empty string if not yet created
- `tags` = searchable labels for filtering plans (e.g., auth, payments, ui)
- `mode` = execution mode (fast/deep), `triage` = scope assessment (small/normal/large/massive)
- `scope` = milestone-N (if split from large feature) or full (entire feature)
- Sub-Task links use reference-style `[stNN]` at bottom for clean reading
- Code Impact from code-analysis step — summary only, details in sub-task files
- Dependency Graph = ASCII visualization showing sub-task execution order
- Execution Batches = how bk-code groups sub-tasks for implement → test → review cycles
- Test Strategy Summary = aggregated from all sub-task `## Test Plan` sections
- Review Strategy Summary = aggregated from all sub-task `## Review Checklist` sections
- Gaps: include severity + assumption/decision from gap-escalation step
- `Next:` line at bottom = handoff command for bk-code
