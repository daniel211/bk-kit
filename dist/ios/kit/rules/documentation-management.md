---
paths:
  - bk/docs/**
---

# MK Documentation Management

## Plan Structure

Save plans in `./bk/dev/{feature-slug}/` — one directory per feature.
This is the single plan-directory convention: `/bk-spec`, `/bk-plan`, `/bk-code` and
`traceability-check.cjs` all resolve `bk/dev/{feature}/`. Do not use timestamped directory names.

**Format:** `bk/dev/{feature-slug}/`

```
bk/dev/{feature-slug}/
├── research/                 # Research reports from scouts/researchers
├── reports/                  # Agent output reports
├── plan.md                   # Overview — under 80 lines, links to sub-tasks
├── sub-task-01-{name}.md     # Detailed sub-task files
├── sub-task-02-{name}.md
└── ...
```

### plan.md (Overview)
- Keep generic and under 80 lines
- List each sub-task with status (⬜/🔄/✅)
- Link to sub-task files; note key dependencies

### Sub-Task Files
Templates: `skills/bk-plan/templates/sub-task-{coding,ui,test,input-extraction}.md`.
Each sub-task file contains:
- **Scope** — files to create/modify, LOC estimate
- **Input References** — PRD section, API endpoints, dependency outputs
- **Existing Code / Expected Code** — patterns to follow, implementation spec
- **Tasks** — checkbox tracking (the ONLY checkbox section used for progress)
- **Edge Cases & Risks** — potential issues + mitigations
- **Success Criteria** — definition of done
- **Test Plan** — test cases for this sub-task
- **Review Checklist** — sub-task-specific review checks (incl. auth, Keychain/Keystore, cert pinning)

## Report Conventions

- Path: `bk/dev/shared/reports/`
- Naming: `{agent-type}-{feature}.md` (e.g., `code-review-payment.md`, `security-auth.md`)
- Reports must include `## ` header and `<!-- metadata: {...} -->` footer (per `output-gate.md`)
- Concise — sacrifice grammar for brevity; unresolved questions at end

## Docs Sync

Maintain living docs when significant changes occur:

### Triggers
- Feature implementation completed
- Major milestone reached
- Significant bug fixed
- Architecture or API changes
- Breaking changes introduced

### Update Protocol
1. Read current doc status before updating
2. Update relevant docs (architecture, code standards, changelog)
3. Verify cross-references and links
4. State docs impact in completion message: `Docs impact: [none|minor|major]`

## Foundation Docs Maintenance

Foundation docs (`bk/docs/foundation/`) are the single source of truth for project context.

### When to Update
- After significant architecture changes → update `architecture.md`
- After adding major dependencies → update `dependencies.md`
- After changing build config → update `build-targets.md`
- After UI redesign → update `design-system.md`

### How to Update
- Run `/bk-bootstrap --refresh` for full re-scan
- Or manually update specific files with evidence

### Never
- Delete foundation docs without replacement
- Edit foundation docs during feature implementation (they are reference-only during `/bk-code`)

## State Tracking

- Workflow state persisted in `bk/dev/shared/.workflow-state.json`
- See `state-machine.md` for FSM transitions and persistence schema
- On context compaction: resume from last persisted state, not from scratch
