---
paths:
  - mk/docs/**
---

# MK Documentation Management

## Plan Structure

Save plans in `./mk/dev` directory with timestamp and descriptive name.

**Format:** `mk/dev/{YYMMDD}-{HHMM}-{descriptive-slug}/`

```
mk/dev/{YYMMDD}-{HHMM}-{slug}/
├── research/              # Research reports from scouts/researchers
├── reports/               # Agent output reports
├── plan.md                # Overview — under 80 lines, links to phases
├── phase-01-{name}.md     # Detailed phase files
├── phase-02-{name}.md
└── ...
```

### plan.md (Overview)
- Keep generic and under 80 lines
- List each phase with status (⬜/🔄/✅)
- Link to phase files; note key dependencies

### Phase Files
Each phase file contains:
- **Overview** — priority, status, brief description
- **Requirements** — functional + non-functional
- **Related Code Files** — files to modify/create/delete
- **Implementation Steps** — numbered, specific instructions
- **Todo List** — checkbox tracking
- **Success Criteria** — definition of done
- **Risk Assessment** — potential issues + mitigations
- **Security Considerations** — auth, data protection (mobile: Keychain/Keystore, cert pinning)

## Report Conventions

- Path: `mk/dev/shared/reports/`
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

Foundation docs (`mk/docs/foundation/`) are the single source of truth for project context.

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

- Workflow state persisted in `mk/dev/shared/.workflow-state.json`
- See `state-machine.md` for FSM transitions and persistence schema
- On context compaction: resume from last persisted state, not from scratch
