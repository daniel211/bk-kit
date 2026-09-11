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
