# Critic Review

Adversarial plan review by a **dispatched agent** (not self-review).

## When to Run

- Deep mode: always
- Fast mode: skip
- Auto: run if >= 4 phases

## Dispatch

Critic is dispatched as `bk-code-reviewer` subagent via Task tool.
See `agent-dispatch.md` for exact prompt and output format.

Key rules:
- Critic is a **separate agent** — never review your own plan
- Dispatched in background (non-blocking)
- Reads plan files from disk, writes review to `{plan-dir}/research/critic-review.md`
- Uses Glob to verify file citations against actual codebase

## Scoring Dimensions

| # | Dimension | What to Check |
|---|-----------|---------------|
| 1 | **File citations** | Do referenced existing files actually exist? Glob verify. |
| 2 | **Expected code quality** | Does preview code follow detected architecture patterns? |
| 3 | **Dependency chain** | Phase deps logical? No circular deps? Bottom-up order? |
| 4 | **Platform coverage** | All target platforms addressed in each relevant phase? |
| 5 | **Test coverage** | Test phase covers all P0 requirements? Edge cases listed? |
| 6 | **Localization** | UI phases have complete Strings tables? No hardcoded text in expected code? |
| 7 | **Blast radius accuracy** | Code Impact matches actual affected files? Indirect impacts noted? |

### Scoring Guide

- **9-10**: Excellent — thorough, verified, no gaps
- **7-8**: Good — minor omissions, nothing blocking
- **5-6**: Acceptable — some gaps, but workable
- **3-4**: Weak — significant issues, needs revision
- **1-2**: Poor — major gaps, likely to fail during implementation

## Verdict

| Verdict | Condition | Action |
|---------|-----------|--------|
| **OKAY** | avg >= 6 AND no dimension below 4 | Copy to plan.md, proceed |
| **REVISE** | avg >= 4 BUT some dimension below 4 | Apply fixes, re-dispatch (max 1 retry) |
| **REJECT** | avg < 4 | Present issues to user, ask: revise or proceed |

## Handling Results

1. Read `{plan-dir}/research/critic-review.md`
2. Copy scoring table to plan.md `## Critic Review` section
3. **OKAY**: proceed to validate
4. **REVISE**:
   - Read `## Suggested Fixes` from critic output
   - Apply fixes by re-dispatching `bk-planner` (foreground) with the Suggested Fixes; the conductor does NOT edit plan.md/sub-task-*.md prose itself (only the `## Critic Review` record + status cells)
   - Update `.plan-state.json`: set step 7 status to `"retrying"` (not `"complete"`)
   - Re-dispatch critic (1 retry max)
   - On retry success: update step 7 to `"complete"`
   - If still REVISE after retry: present to user with issues
5. **REJECT**: show full review to user, **use `AskUserQuestion` tool**:
   ```json
   {
     "questions": [{
       "question": "Critic rejected plan (avg score < 4). See review above.",
       "header": "Plan Rejected by Critic",
       "options": [
         { "label": "Revise plan", "description": "Apply critic suggestions and re-plan" },
         { "label": "Proceed anyway", "description": "Accept risks and continue" },
         { "label": "Cancel plan" }
       ]
     }]
   }
   ```
