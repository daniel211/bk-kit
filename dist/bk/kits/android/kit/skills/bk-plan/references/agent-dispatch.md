# Agent Dispatch Protocol

How bk-plan dispatches subagents. Exact prompts, output contracts, handoff paths.

## Researcher Dispatch (Step 4)

Spawn max 2 researchers in parallel (background). Each gets a focused angle.

### Researcher 1: Domain & API Research

```
Task(
  subagent_type: "bk-researcher",
  model: "sonnet",
  run_in_background: true,
  description: "Research domain for {feature}",
  prompt: "
    Task: Research domain knowledge for planning '{feature}' on {platform}

    Context:
    - Feature: {feature description}
    - Platform: {platform}
    - Detected patterns: (read from {plan-dir}/research/code-analysis-summary.md)
    - API specs available: {yes/no, summary from inputs/api.json}

    Research:
    1. Best practices for {domain} in {platform} apps
    2. Common pitfalls and edge cases
    3. Library/framework recommendations (if applicable)
    4. Security considerations for {domain}

    Output: {plan-dir}/research/researcher-1-domain.md
    ```markdown
    # Domain Research: {feature}
    ## Key Findings
    - {finding with source}
    ## Recommended Approach
    - {approach with rationale}
    ## Pitfalls to Avoid
    - {pitfall}: {why and mitigation}
    ## Security Notes
    - {consideration}
    ```
  "
)
```

### Researcher 2: Platform Patterns Research

```
Task(
  subagent_type: "bk-researcher",
  model: "sonnet",
  run_in_background: true,
  description: "Research platform patterns for {feature}",
  prompt: "
    Task: Research platform-specific implementation patterns for '{feature}'

    Context:
    - Platform: {platform}
    - Architecture: (read from {plan-dir}/research/code-analysis-summary.md)
    - Existing patterns: (DI, navigation, networking from code-analysis-summary.md)
    - Design specs available: {yes/no, summary from inputs/design.json}

    Research:
    1. {platform} best practices for this feature type
    2. Platform-specific UI patterns (e.g., SwiftUI vs Compose idioms)
    3. State management approach for this feature
    4. Testing strategy (what's testable, what needs mocking)

    Output: {plan-dir}/research/researcher-2-platform.md
    ```markdown
    # Platform Research: {feature} on {platform}
    ## Implementation Patterns
    - {pattern}: {when to use, code example}
    ## UI Approach
    - {recommendation with platform rationale}
    ## State Management
    - {approach}: {why for this feature}
    ## Testing Strategy
    - Unit: {what to test}
    - Integration: {what to test}
    - Not testable: {what and why}
    ```
  "
)
```

### Collecting Research

After both researchers complete:
1. Read `{plan-dir}/research/researcher-1-domain.md`
2. Read `{plan-dir}/research/researcher-2-platform.md`
3. Cross-reference findings — flag contradictions
4. Feed agreed findings into plan synthesis step

## Critic Dispatch (Step 7)

Dispatch critic as **separate agent** (not self-review). Background, reads plan output.

```
Task(
  subagent_type: "bk-code-reviewer",
  model: "sonnet",
  run_in_background: true,
  description: "Critic review plan for {feature}",
  prompt: "
    Task: Adversarial review of plan for '{feature}'

    Read:
    - {plan-dir}/plan.md
    - All {plan-dir}/phase-*.md files
    - {plan-dir}/inputs/*.json (if exist)

    Score 7 dimensions (1-10 each):
    1. File citations — Do referenced existing files actually exist? Glob verify.
    2. Expected code quality — Does preview follow detected architecture patterns?
    3. Dependency chain — Phase deps logical? No circular? Bottom-up?
    4. Platform coverage — All target platforms in each relevant phase?
    5. Test coverage — Tests cover all P0 reqs? Edge cases listed?
    6. Localization — UI phases have complete Strings tables? No hardcoded text?
    7. Blast radius accuracy — Code Impact matches actual affected files?

    Verdict:
    - OKAY: avg >= 6 AND no dimension < 4
    - REVISE: avg >= 4 BUT some dimension < 4
    - REJECT: avg < 4

    Output: {plan-dir}/research/critic-review.md
    ```markdown
    # Critic Review: {feature}

    | Dimension | Score | Notes |
    |-----------|-------|-------|
    | File citations | {N} | {details} |
    | Expected code | {N} | {details} |
    | Dependencies | {N} | {details} |
    | Platform coverage | {N} | {details} |
    | Test coverage | {N} | {details} |
    | Localization | {N} | {details} |
    | Blast radius | {N} | {details} |

    **Average: {N} — Verdict: {OKAY|REVISE|REJECT}**

    ## Issues Found
    - [{severity}] {issue}: {fix suggestion}

    ## Suggested Fixes
    - Phase {N}: {what to fix}
    ```

    IMPORTANT: You are reviewing someone else's plan. Be objective.
    Verify file paths with Glob. Check real codebase patterns.
  "
)
```

### Handling Critic Results

1. Read `{plan-dir}/research/critic-review.md`
2. If **OKAY**: Copy scoring table to plan.md `## Critic Review`, proceed
3. If **REVISE**: Apply suggested fixes to phase files, re-dispatch critic (max 1 retry)
4. If **REJECT**: Present issues to user, ask: revise plan or proceed anyway

## Code Analysis Scout (Step 3)

For large codebases (>500 files), scout affected areas before full analysis.

```
# Scout pattern — run inline, not as separate agent
Glob("**/*.swift") or Glob("**/*.kt") or Glob("**/lib/**/*.dart")
→ count files
→ if > 500: narrow search to feature-relevant directories
→ Grep for keywords from feature description
→ Focus code analysis on matched files only
```

## Output Directory Contract

```
{plan-dir}/
├── research/
│   ├── code-analysis-summary.md    # Step 3: planner writes (inline, not dispatched)
│   ├── researcher-1-domain.md      # Step 4: researcher agent output
│   ├── researcher-2-platform.md    # Step 4: researcher agent output
│   └── critic-review.md            # Step 7: critic agent output
├── plan.md
├── phase-*.md
└── inputs/
```

All agent outputs go to `{plan-dir}/research/`. Planner reads from there.
Agents write to pre-agreed paths — no prompt-based output passing.

## Planner Dispatch (Step 8 — foreground, MUST)

DO NOT write `plan.md` / `sub-task-*.md` yourself. Dispatch bk-planner.
`"bk-planner"` is the CUSTOM agent (`agents/bk-planner.md`): opus model, serena MCP,
`Task(Explore)` / `Task(bk-researcher)`, skills(bk-architecture, bk-sequential-thinking,
bk-docs-seeker), project memory. DO NOT use the built-in `Plan()` agent — it has none of these.

```
TaskUpdate(taskId=T5, status="in_progress")
Task(subagent_type: "bk-planner", model: "opus",
  description: "Create implementation plan for {feature}", prompt: "
  Task: Create sub-task-based implementation plan
  Feature: {feature_description}
  Platform: {platform}
  Context:
    - bk/docs/foundation/ (project context — architecture, guidelines, deps)
    - {plan-dir}/research/code-analysis-summary.md (Step 5 code impact analysis)
    - {plan-dir}/research/researcher-*.md (Step 6 research outputs)
    - {plan-dir}/inputs/ (design.json, requirements.json if exist)
    - {plan-dir}/srs.md (if exists)
  Scope: {triage_result — small/normal/large/massive from Step 2}
  Gap decisions: {gap_decisions from Step 7 if any}
  Templates: references/plan-synthesis.md, templates/plan-summary.md,
    templates/sub-task-coding.md, sub-task-ui.md, sub-task-test.md
  Output: {plan-dir}/plan.md + {plan-dir}/sub-task-*.md
  Constraints: plan.md < 60 lines, sub-task 30-80 lines each
")
TaskUpdate(taskId=T5, status="completed")
```

bk-planner workflow: ORIENT (read Serena memories + foundation) → RESEARCH (Explore/serena) →
STRUCTURE → WRITE → SAVE. The conductor reads the plan output, then proceeds to Step 8b.

If parallel mode: add an `execution: parallel` instruction plus `owns:` glob enforcement to the
planner prompt, and load `references/parallel-planning.md`.

## Step 8b: Plan Quality Self-Check (before the critic)

- Files are named `sub-task-NN-{slug}.md` — never `phase-*.md` (bk-code globs `sub-task-*`)
- Every sub-task has ≥3 concrete file paths in `## Scope`
- Every sub-task has an `## Expected Code` section with actual code preview
- Every sub-task has a `## Tasks` checkbox list (bk-code's only hydration source)
- Every sub-task has `## Success Criteria` with testable conditions
- No sub-task file exceeds 120 lines
- `plan.md` references foundation docs where relevant
- IF any check fails → fix before proceeding to the critic

## Requirement Tracing

Each sub-task SHOULD carry the IDs it fulfils in YAML frontmatter, in the `reqs:` field
(`traces:` is the pre-0.6.0 spelling — read-only, never emit it):

```
---
reqs: [UC-001, NFR-SEC-001]
---
```

IDs are copied verbatim from their source and never renumbered: `UC-`/`NFR-` from a `/bk-spec`
SRS, `REQ-`/`TC-` from enterprise docs extracted in Step 4b, `REQ-` derived in Step 3 when there
is no formal source. bk-planner maps them to sub-tasks. If no requirement source exists,
`reqs: []` — and the sub-task's `## Scope` says why. Protocol: `rules/traceability.md`.
