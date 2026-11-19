---
name: bk-research
description: "Research any topic with focused subagents. Quick mode for fast answers, deep mode for parallel multi-angle investigation."
user-invocable: true
argument-hint: "<topic> [--mode quick|deep]"
---

# Research: $ARGUMENTS

Dispatch researcher subagents to investigate a topic and produce a structured report.

## Arguments

- `<topic>` — Research subject (required)
- `--mode quick` — Single researcher, fast turnaround (default)
- `--mode deep` — 3 parallel researchers with different angles

## When to Use

- Exploring unfamiliar domain before planning
- Investigating platform-specific patterns or libraries
- Comparing architectural approaches
- User asks to "research", "investigate", or "explore" a topic
- Called from bk-plan Step 6 for feature research

## Workflow

### 1. Parse Input

- Extract topic from `$ARGUMENTS`
- Detect mode flag (default: `quick`)
- Check if called within a plan context (plan-dir exists)
- Set output path:
  - If plan context: `{plan-dir}/research/`
  - Otherwise: `bk/dev/reports/`

### 2. Quick Mode (1 researcher)

Dispatch single researcher subagent:

```
Task(
  subagent_type: "bk-researcher",
  model: "sonnet",
  description: "Research: {topic}",
  prompt: "
    Task: Research '{topic}'

    Investigate:
    1. Core concepts and best practices
    2. Common pitfalls and edge cases
    3. Recommended approaches with rationale
    4. Relevant tools, libraries, or frameworks

    Output: {output-path}/research-{topic-slug}.md
    ```markdown
    # Research: {topic}
    ## Key Findings
    - {finding with source/rationale}
    ## Recommended Approach
    - {approach}: {why}
    ## Pitfalls
    - {pitfall}: {mitigation}
    ## References
    - {links or docs consulted}
    ```
  "
)
```

### 3. Deep Mode (3 parallel researchers)

Spawn 3 researchers in parallel, each with a different angle:

**Researcher 1: Domain Knowledge**
```
Task(
  subagent_type: "bk-researcher",
  model: "sonnet",
  run_in_background: true,
  description: "Domain research: {topic}",
  prompt: "
    Task: Deep-dive domain knowledge for '{topic}'

    Research:
    1. Foundational concepts and terminology
    2. Industry best practices and standards
    3. Security and compliance considerations
    4. Real-world case studies or patterns

    Output: {output-path}/researcher-1-domain.md
    ```markdown
    # Domain Research: {topic}
    ## Core Concepts
    ## Best Practices
    ## Security Notes
    ## Case Studies
    ```
  "
)
```

**Researcher 2: Technical Implementation**
```
Task(
  subagent_type: "bk-researcher",
  model: "sonnet",
  run_in_background: true,
  description: "Technical research: {topic}",
  prompt: "
    Task: Technical implementation research for '{topic}'

    Research:
    1. Architecture patterns and design approaches
    2. Library/framework comparison (if applicable)
    3. Performance considerations
    4. Testing strategies

    Output: {output-path}/researcher-2-technical.md
    ```markdown
    # Technical Research: {topic}
    ## Architecture Patterns
    ## Libraries & Frameworks
    ## Performance
    ## Testing Strategy
    ```
  "
)
```

**Researcher 3: Ecosystem & Alternatives**
```
Task(
  subagent_type: "bk-researcher",
  model: "sonnet",
  run_in_background: true,
  description: "Ecosystem research: {topic}",
  prompt: "
    Task: Ecosystem and alternatives research for '{topic}'

    Research:
    1. Alternative approaches and trade-offs
    2. Community adoption and maturity
    3. Integration with common mobile stacks
    4. Future outlook and migration paths

    Output: {output-path}/researcher-3-ecosystem.md
    ```markdown
    # Ecosystem Research: {topic}
    ## Alternatives Compared
    ## Community & Maturity
    ## Integration Notes
    ## Future Outlook
    ```
  "
)
```

### 4. Synthesize

After all researchers complete:

1. Read all researcher output files
2. Cross-reference findings — flag contradictions
3. Write consolidated report:

```markdown
# Research Report: {topic}
## Mode: {quick|deep}

## Summary
{2-3 sentence overview}

## Key Findings
- {merged findings, deduplicated}

## Recommended Approach
- {synthesized recommendation with rationale}

## Trade-offs & Alternatives
- {option}: {pros/cons}

## Pitfalls
- {pitfall}: {mitigation}

## Open Questions
- {unresolved items needing user input}

## Sources
- {researcher files, links, docs}
```

Output path: `{output-path}/research-report-{topic-slug}.md`

### 5. Present

- Show summary to user
- If called from bk-plan: return path to consolidated report for plan synthesis

## Constraints

- Quick mode: 1 subagent, no background dispatch
- Deep mode: max 3 parallel subagents
- Each researcher report under 80 lines
- Consolidated report under 100 lines
- Use web search tools when available for up-to-date information
- Researchers write to pre-agreed file paths, not prompt-based output
