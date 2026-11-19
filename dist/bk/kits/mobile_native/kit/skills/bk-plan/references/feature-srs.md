# Feature SRS Generation

Auto-generate feature-level SRS within bk-plan workflow.

## Input

- `bk/docs/srs/*.md` (project-level SRS, if exists)
- Feature name + description from args
- Foundation context (from Step 1)

## Process

### 1. Extract from Project SRS

IF `bk/docs/srs/` exists:
```
Grep project SRS for feature keywords:
  bk/docs/srs/functional-requirements.md → matching use cases (UC-*)
  bk/docs/srs/nonfunctional-requirements.md → relevant NFRs
  bk/docs/srs/ui-ux-requirements.md → matching screens
  bk/docs/srs/api-contract.md → matching endpoints
```

### 2. Fallback (no project SRS)

IF `bk/docs/srs/` missing:
- Generate from feature description + foundation data only
- Note in output: "No project SRS — requirements derived from description"

### 3. Brief User Interview (2-3 questions) — via `AskUserQuestion` tool

**MUST use `AskUserQuestion` tool** — never output questions as plain text.

```json
{
  "questions": [
    {
      "question": "Core user flow cho feature này?",
      "header": "User Flow"
    },
    {
      "question": "Constraints đặc biệt?",
      "header": "Constraints",
      "multiSelect": true,
      "options": [
        { "label": "Offline support needed" },
        { "label": "Requires authentication" },
        { "label": "Performance-critical" },
        { "label": "None / standard" }
      ]
    },
    {
      "question": "Scope: must-have vs nice-to-have?",
      "header": "Scope"
    }
  ]
}
```

### 4. Write Feature SRS

Write to `bk/dev/{feature}/srs.md`:

```markdown
# Feature SRS: {feature name}

## Scope
{from user interview Q1 + Q3}

## Requirements (from project SRS)
| ID | Description | Priority | Screen | API |
|----|-------------|----------|--------|-----|
{extracted matching use cases}

## Feature-Specific Requirements
{from user interview, not in project SRS}

## Constraints
{from Q2}

## Related NFRs
{extracted from project SRS nonfunctional-requirements.md}

## Acceptance Criteria
{merged from project SRS UC criteria + feature-specific}
```

## Consumed By

- bk-plan synthesis → sub-task files reference `srs.md` requirements via `reqs` YAML field
- bk-plan test sub-tasks → acceptance criteria from `srs.md`
- bk-code → requirements traceability (code-reviewer checks `reqs` coverage)

## Skip Conditions

- Fast mode → skip entirely (plan from description only)
- Trivial scope (single file change) → skip
