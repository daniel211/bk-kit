# Validate Interview

Critical questions interview before approving the plan.

## When to Run

- Deep mode: always (after critic review)
- Fast mode: skip
- Auto: run if critic verdict is REVISE, or if plan has gaps

## Process

1. Read plan.md + phase files
2. Detect question topics using keyword detection (see Question Categories)
3. Generate 3-6 concrete questions with options
4. **Interview user via `AskUserQuestion` tool** — group related questions (max 4 per call)
5. Record answers in plan.md `## Validation Log`
6. Propagate decisions to affected phase files

## Question Categories

| Category | Keywords to Detect | Example |
|----------|-------------------|---------|
| **Architecture** | "approach", "pattern", "protocol", "DI", "structure", "service" | "AuthService as protocol or concrete class?" |
| **Platform** | "platform", "iOS", "Android", "shared", "native", "divergent" | "Same OAuth flow both platforms, or native per-platform?" |
| **Scope** | "deferred", "MVP", "future", "out of scope", "nice to have" | "REQ-003 biometric deferred — include in this plan or separate?" |
| **Risk** | "risk", "blast radius", "shared", "breaking", "dependency" | "APIClient interceptor affects all calls — add feature flag?" |
| **Data** | "assume", "missing", "not in spec", "pagination", "default" | "API pagination not in spec — assume none or plan for it?" |

## Question Format

Each question:
- 2-4 concrete options
- Mark recommended with "(Recommended)"
- "Other" always available for custom answer
- Questions should surface implicit decisions, not obvious ones

Example:
```
Question: "How should token refresh failure be handled?"
Options:
1. Silent logout → login screen (Recommended)
2. Show error dialog with retry
3. Keep expired token, fail on next API call
```

## Recording

Add or append `## Validation Log` to plan.md. Increment session number from last session.

```markdown
## Validation Log

### Session {N} — {YYYY-MM-DD}
**Trigger:** {what prompted this validation — e.g., critic REVISE verdict, deep mode}
**Questions asked:** {count}

1. **[Architecture]** AuthService as protocol or concrete class?
   - Options: Protocol + impl (Recommended) | Concrete class | Protocol only
   - **Answer**: Protocol + impl
   - **Custom input**: {verbatim "Other" text if applicable}
   - **Rationale**: Protocol enables DI + testability, matches existing service patterns
   - **Impact**: Phase 2 expected code uses protocol pattern

2. **[Scope]** Include biometric re-auth in this plan?
   - Options: Yes, add phase | No, separate plan (Recommended) | Stub only
   - **Answer**: No, separate plan
   - **Rationale**: Biometric has own UX flow, separate plan keeps scope tight
   - **Impact**: Confirmed in Gaps section

#### Confirmed Decisions
- AuthService: protocol + impl — consistency with existing service layer
- Biometric: separate plan — scope control

#### Action Items
- [ ] Update Phase 2 expected code to use protocol pattern
```

### Recording Rules
- **Full question text**: exact question, not summary
- **All options**: every option presented
- **Verbatim custom input**: record "Other" text exactly as user typed
- **Rationale**: explain why decision affects implementation
- **Session numbering**: increment from last session in existing Validation Log

## Propagation

After recording answers, update affected phase files:

| Change Type | Target Section in Phase |
|-------------|----------------------|
| Architecture | Expected Code / Architecture |
| Platform | Expected Code (per-platform sections) |
| Scope | Overview / Implementation Steps |
| Risk | Risk Assessment |
| Data | Key Insights (new subsection if needed) |

- Add comment marker: `<!-- Validated: {decision summary} -->`
