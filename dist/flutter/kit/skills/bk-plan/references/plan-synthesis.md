# Plan Synthesis

Assemble plan.md + sub-task files from research + code analysis + P3 inputs + gap decisions.

## Thinking Order

Apply mental models in sequence:

1. **Working Backwards** — write Success Criteria first for each sub-task → derive scope from it
2. **Systems Thinking** — how does feature connect/break existing code? (from code analysis)
3. **80/20 MVP** — P0 requirements first, defer P2/could-have to gaps
4. **User Journey** — trace full flow start-to-finish, no missing screens/states/errors

## Input Sources for Synthesis

Read before synthesizing:

| Source | Path | What to Extract |
|--------|------|-----------------|
| P3 inputs | `{plan-dir}/inputs/*.json` | Design specs, API models, requirements |
| Code analysis | (inline from step 3) | Architecture patterns, affected files, blast radius |
| Research | `{plan-dir}/research/researcher-*.md` | Domain knowledge, platform patterns |
| Gap decisions | `.plan-state.json` → `gapDecisions` | User decisions on CRITICAL/HIGH gaps |

## Sub-Task Decomposition Rules

### Thinking Order
1. Trace user flow end-to-end (from PRD/BRD)
2. Identify data dependencies (models → repository → ViewModel → UI)
3. Break each layer into 1 sub-task
4. Add test sub-tasks (parallel where possible)
5. Add integration sub-task last
6. Assign dependencies: bottom-up (data first, UI last)
7. Identify parallel opportunities (tests || UI when ViewModel ready)

### Sub-Task Sizing
- Target: 30-80 LOC expected output per sub-task
- Max: 3-5 files owned per sub-task
- If sub-task > 100 LOC → split into 2 sub-tasks
- If sub-task < 20 LOC → merge with adjacent sub-task

### Standard Sub-Task Pattern (for typical feature)

| # | Type | Content | Depends | Parallel |
|---|------|---------|---------|----------|
| 00 | coding | Data models + API client | — | — |
| 01 | coding | Repository / Service layer | 00 | — |
| 02 | coding | ViewModel / Business logic | 00, 01 | — |
| 03 | ui | UI Screen(s) from Figma | 02 | 05 |
| 04 | coding | Navigation / Integration | 03 | — |
| 05 | test | Unit tests (ViewModel, Repository) | 02 | 03 |
| 06 | test | Integration tests + edge cases | all | — |

Data flows bottom-up: models first, then services, then ViewModel, then UI.
Tests run parallel with UI when ViewModel is ready.

### Batch Grouping (for bk-code execution)

Sub-tasks are grouped into batches for implement → test → review cycle:

| Batch | Sub-Tasks | Review Focus |
|-------|-----------|-------------|
| Data layer | 00, 01 | API integration, data mapping, error handling |
| Logic + UI | 02, 03, 04, 05 | Business logic, UI/Figma match, test coverage |
| Integration | 06 | End-to-end flow, edge cases |

## Requirement Traceability

Every sub-task traces back to a requirement:

1. If `inputs/requirements.json` exists: use REQ-IDs from extraction
2. If no formal requirements: derive IDs from feature description (REQ-01, REQ-02, ...)
3. Sub-task YAML `reqs` field lists which REQ-IDs the sub-task fulfills
4. Sub-task `## Refs` section maps REQ-ID → brief text
5. Test sub-task cases map to REQ-IDs via Priority column

Traceability chain: `Requirement → Sub-Task → Test Case → Review Checklist`

Chain example: BRD-001 → sub-task-02 → test_login_success → review checklist item.

### Test Plan in Sub-Tasks
Every coding/UI sub-task has `## Test Plan` section listing tests needed.
Test sub-tasks (05, 06) aggregate test cases from coding sub-tasks.
bk-plan generates test cases during planning — bk-code executes them.

### Review Checklist in Sub-Tasks
Every sub-task has `## Review Checklist` — specific checks for that sub-task.
bk-code feeds checklist to bk-code-reviewer dispatch prompt.

## File Ownership

Each sub-task declares files it owns (for parallel execution safety):

1. Analyze Expected Code sections — which files does each sub-task create/modify?
2. Add `owns` field to sub-task YAML frontmatter with glob patterns
3. Verify no overlap between sub-tasks
4. Shared files (router, DI container) → assign to ONE sub-task only
5. If ownership conflict: restructure sub-tasks to eliminate overlap

## Template Selection

| Sub-Task Type | Template | Trigger |
|--------------|----------|---------|
| Coding (no UI) | `templates/sub-task-coding.md` | Models, services, utilities, ViewModels |
| UI screen | `templates/sub-task-ui.md` | Sub-task touches screens, has Figma data |
| Tests | `templates/sub-task-test.md` | Unit/integration test sub-tasks |

## Expected Code Guidelines

Expected Code = preview spec for user review, not final implementation.

Rules:
- Show structure, signatures, key logic — not every line
- Include platform-specific variants (iOS + Android / Flutter sections)
- Reference existing patterns: "follows `{file}:{line}` pattern"
- Use localized string keys in UI code, never hardcoded text
- Mark file operations clearly:
  - `// {path} — NEW` for new files
  - `// {path} — MODIFY (line XX+)` for existing file changes
- For multi-platform: show each platform's code in separate fenced blocks

## plan.md Assembly

Use `templates/plan-summary.md`. Populate:
- YAML frontmatter from parsed arguments + triage result + detected platform:
  - `title`: human-readable feature title from parsed arguments
  - `priority`: derive from triage (massive→P0, large→P1, normal→P2, small→P3)
  - `effort`: derive from triage (small→hours, normal→days, large→days, massive→weeks)
  - `branch`: git branch if known (check current branch), else empty string
  - `tags`: infer 2-5 relevant tags from feature domain (e.g., auth, payments, ui, networking)
- Inputs table from P3 extraction results
- Code Impact from code analysis output
- Sub-Tasks table with deps + parallel-with + links to sub-task files
- Dependency Graph (ASCII visualization of sub-task dependencies)
- Execution Batches table (for bk-code auto-chain)
- Test Strategy Summary (aggregated from sub-task test plans)
- Review Strategy Summary (batch review focus areas)
- Gaps from gap escalation decisions + missing inputs + deferred requirements

## Foundation Cross-Reference Rule

Every sub-task file MUST include a `## Foundation References` section:

```markdown
## Foundation References
- Architecture: MVVM + Clean Architecture (from mk/docs/foundation/architecture.md)
- Naming: PascalCase for classes, camelCase for functions (from mk/docs/foundation/code-guidelines.md)
- State: @Observable macro (from mk/docs/foundation/architecture.md)
- Test Pattern: MockRepository protocol (from mk/docs/foundation/code-guidelines.md)
```

This ensures every developer agent has context without re-scanning the project.
The values above are examples — populate with actual data from `foundation_context` (Step 1).

## Sub-Task File Assembly

1. Pick template by sub-task type (coding, UI, test)
2. Fill YAML frontmatter (sub-task, title, depends, parallel-with, platform, reqs, owns)
3. Scope: list new/modified files + LOC estimate
4. Input References: PRD section, API endpoint, dependency outputs
5. Existing Code: paste snippets from code analysis
6. Design Specs: paste Figma data from inputs/design.json (UI sub-tasks)
7. Expected Code: write per-platform previews following detected patterns
8. Strings table: extract all user-visible text with i18n keys (UI sub-tasks)
9. Edge Cases & Risks: list scenarios that need handling
10. Success Criteria: concrete, verifiable criteria
11. Test Plan: list test cases with type + priority + what they verify
12. Review Checklist: sub-task-specific checks for code reviewer
13. Refs: REQ-IDs, endpoints, pattern references
