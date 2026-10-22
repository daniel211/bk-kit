# Feature Triage

Detect feature scope and complexity before planning. Routes to normal plan or suggests splitting.

## Triage Questions (Silent — No User Interaction)

Planner evaluates these internally, no prompts to user:

| # | Question | Signal for Large |
|---|----------|-----------------|
| Q1 | How many screens/views? | > 5 screens |
| Q2 | How many API endpoints? | > 8 endpoints |
| Q3 | Cross-cutting concerns? | Auth + storage + networking + navigation all touched |
| Q4 | Multi-platform divergence? | Platforms need different implementations (not just UI) |
| Q5 | Shared module changes? | Modifying base classes, DI container, or interceptors |
| Q6 | New domain knowledge? | Team has no prior experience with this domain |

## Scoring

Count strong signals (questions answered "yes"):

| Signals | Scope | Action |
|---------|-------|--------|
| 0-1 | **Small** | Fast mode sufficient |
| 2-3 | **Normal** | Standard plan (fast or deep based on mode) |
| 4-5 | **Large** | Deep mode required. Consider splitting. |
| 6 | **Massive** | Recommend vertical slicing into milestones |

## Vertical Slicing (Large/Massive)

When feature is too large for a single plan (>8 phases projected):

### Suggest Split to User — via `AskUserQuestion` tool

**MUST use `AskUserQuestion` tool** — never output as plain text.

```json
{
  "questions": [{
    "question": "Feature \"{name}\" is large ({N} phases, {signals} complexity signals).\n\nRecommend vertical slices:\n- M1: {thinnest happy path}\n- M2: {error handling + edge cases}\n- M3: {secondary flows}\n\nEach milestone = separate plan.",
    "header": "Feature Split",
    "options": [
      { "label": "Plan Milestone 1 now", "description": "Recommended — thinnest happy path" },
      { "label": "Plan entire feature", "description": "Will be 8+ phases" },
      { "label": "Adjust milestones", "description": "I'll redefine the slices" }
    ]
  }]
}
```

### Vertical Slice Principles

- Each milestone delivers **user-visible value** through all layers (UI → service → API → data)
- M1 = simplest end-to-end flow (e.g., login with email only, no social, no biometric)
- M2+ = add capabilities incrementally
- Never slice horizontally (all models first, then all services, then all UI)

### If User Chooses Full Plan

Proceed with deep mode. Plan will have many phases but remains a single plan.
Add `scope: full` to plan.md YAML. Note in Gaps: "Consider splitting for parallel work."

## Output

Triage result feeds into:
- `.plan-state.json`: `"triage": "small|normal|large|massive"`
- Mode selection: small → fast, normal → auto, large/massive → deep
- plan.md YAML: `complexity` field reflects triage
- If split: only plan current milestone, note others in Gaps

## Integration with Workflow

Triage happens inside Step 1 (Parse & Triage), after parsing arguments and detecting platform.
No separate agent — planner evaluates triage inline using codebase signals from quick Glob/Grep scan.
