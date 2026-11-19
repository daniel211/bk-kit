# Plan Validation Workflow

Interview-based validation for plan quality.

## When to Run
- After plan creation in Hard/Parallel/Two modes
- Skipped in Fast mode
- Can be invoked manually: reference this file

## Validation Questions (3-8 questions via AskUserQuestion)

Target areas: assumptions, risks, trade-offs, architecture

### Question Templates:

1. **Assumptions:** "Plan assumes {X}. Is this correct? What if {opposite}?"
2. **Risks:** "Top risk is {X}. Mitigation: {Y}. Is this sufficient?"
3. **Trade-offs:** "Chose {A} over {B} because {reason}. Do you agree?"
4. **Architecture:** "Pattern: {X}. Fits because {Y}. Any concerns?"
5. **Scope:** "Feature scope: {list}. Anything missing or over-scoped?"
6. **Dependencies:** "Depends on {X}. Is this available? Timeline risk?"
7. **Testing:** "Test strategy: {X}. Coverage gaps: {Y}. Acceptable?"
8. **Security:** "Security considerations: {X}. Anything else?"

### Process:
1. Read plan.md and phase files
2. Generate 3-8 targeted questions based on plan content
3. AskUserQuestion one at a time
4. Update plan based on answers
5. Log validation results in plan.md frontmatter: `validated: true`
