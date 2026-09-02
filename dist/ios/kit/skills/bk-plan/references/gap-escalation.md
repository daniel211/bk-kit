# Gap Escalation

Checkpoint between Research and Synthesis. Aggregate gaps, classify severity, get user decisions before building the plan.

## When to Run

- Deep mode: always (after research, before synthesis)
- Fast mode: skip (gaps listed in plan.md only)
- Auto: run if any CRITICAL/HIGH gaps detected

## Gap Sources

Collect gaps from all previous steps:

| Source | Gap Type | Example |
|--------|----------|---------|
| Input Processing | Missing input | "No Figma provided — UI layout unknown" |
| Code Analysis | Unclear pattern | "DI registration unclear — manual or container?" |
| Code Analysis | Blast radius risk | "APIClient interceptor change affects 20+ files" |
| Researcher 1 | Domain unknown | "OAuth PKCE flow not documented for this provider" |
| Researcher 2 | Platform gap | "iOS 16 minimum — NavigationStack available?" |
| User requirements | Ambiguous scope | "Biometric auth mentioned but not specified" |

## Severity Classification

| Severity | Criteria | Action |
|----------|----------|--------|
| **CRITICAL** | Blocks synthesis — plan cannot be built without answer | **Must ask user** |
| **HIGH** | Plan quality degraded — assumptions may be wrong | **Should ask user** |
| **MEDIUM** | Workable with assumption — note in plan.md Gaps | Note with default assumption |
| **LOW** | Nice-to-have clarification | Ignore, proceed with best guess |

## Escalation Process

### 1. Aggregate

Read all gap sources, deduplicate, classify severity:

```markdown
Gaps found:
- [CRITICAL] No API auth flow specified — cannot plan auth service
- [HIGH] Figma missing for settings screen — UI layout assumed
- [MEDIUM] Pagination not in API spec — assuming no pagination
- [LOW] Icon set preference unknown — using SF Symbols / Material Icons
```

### 2. Ask User (CRITICAL + HIGH only) — via `AskUserQuestion` tool

**MUST use `AskUserQuestion` tool** — never output questions as plain text.
Group related gaps into one call (max 4 questions per call).

```json
{
  "questions": [
    {
      "question": "API auth flow not specified — which approach?",
      "header": "[CRITICAL] Auth Flow",
      "options": [
        { "label": "OAuth2 + PKCE", "description": "Recommended for mobile" },
        { "label": "Token-based", "description": "Simpler, less secure" },
        { "label": "Provide spec", "description": "I'll wait for your input" }
      ]
    },
    {
      "question": "Settings screen Figma missing — how to proceed?",
      "header": "[HIGH] Settings UI",
      "options": [
        { "label": "Plan from description only", "description": "Accept layout assumptions" },
        { "label": "Skip settings screen", "description": "Separate plan later" },
        { "label": "Provide Figma URL now" }
      ]
    }
  ]
}
```

### 3. Record Decisions

Store in `.plan-state.json` under `gapDecisions`:

```json
{
  "gapDecisions": [
    {
      "gap": "API auth flow not specified",
      "severity": "CRITICAL",
      "decision": "OAuth2 + PKCE",
      "decidedBy": "user",
      "impact": "Phase 2 auth service uses PKCE flow"
    }
  ]
}
```

### 4. Feed Into Synthesis

Gap decisions become plan constraints:
- CRITICAL decisions → directly shape Expected Code
- HIGH decisions → noted in phase files as assumptions
- MEDIUM gaps → listed in plan.md `## Gaps` with assumptions
- Unresolved gaps → listed in plan.md `## Gaps` as blocked

## Skip Condition

If no CRITICAL or HIGH gaps found: skip user interaction, proceed to synthesis with MEDIUM/LOW noted in plan.md.
