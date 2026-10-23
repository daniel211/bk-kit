---
name: bk-analyze
description: "Pure exploration — analyze project structure, architecture, dependencies. No FSM, no hooks, no code changes."
user-invocable: true
argument-hint: "[topic: architecture / dependencies / structure / specific module]"
---

# Analyze: $ARGUMENTS

Pure exploration workflow. Analyzes project structure, architecture patterns, and dependencies. No code changes, no FSM state, no approval gates. Optionally dispatches bk-researcher for deep dives into specific technical topics.

<Use_When>
- User wants to understand codebase structure or architecture
- User says "analyze", "explain", "understand", "explore", "what does X do"
- Onboarding to a new project
- Preparing context before planning or debugging
- User invokes `/bk-analyze [topic]`
</Use_When>

<Do_Not_Use_When>
- Code changes needed — use /bk-code, /bk-debug, or /bk-refactor
- Tests needed — use /bk-test
- Planning a feature — use /bk-plan
</Do_Not_Use_When>

## Execution

No FSM. No approval gates. No state persistence. Direct exploration only.

### Step 1: Detect Project

Detect platform per `.claude/rules/core-rules.md` section 1.
Load `config/platform-context.{platform}.json` for project conventions.

### Step 2: Analyze Scope

Based on `$ARGUMENTS`, choose analysis focus:

| Keyword | Focus |
|---------|-------|
| architecture | Clean Architecture layers, MVVM structure, DI setup |
| dependencies | Third-party libraries, versions, dependency graph |
| structure | File/folder layout, module boundaries, naming patterns |
| module / feature | Specific feature: files, classes, data flow |
| (none / broad) | Full project overview: all of the above |

Use Grep, Glob, Read to explore. No MCP calls — pure file system analysis.

Patterns to identify:
- Architecture style (Clean Architecture, MVVM, MVC, etc.)
- State management approach
- Networking layer
- Dependency injection setup
- Test coverage and patterns
- CI/CD configuration

### Step 3: Optional Deep Research

If topic requires external knowledge (library APIs, best practices, comparison with alternatives):

```
Task(subagent_type: "bk-researcher", model: "sonnet", run_in_background: true, prompt: "
  Task: Research {specific_technical_question}
  Research topic: {specific_technical_question}
  Project context: {platform and architecture summary}
  Output: bk/dev/research/{topic}-analysis.md
  Structure:
  ## Key Findings
  - {finding with source}
  ## Best Practices
  - {practice}: {rationale}
  ## Risks/Pitfalls
  - {risk}: {mitigation}
  ## Next Steps
  - {actionable recommendation}
")
```

### Step 4: Output Summary

Present findings directly in conversation:
- Project type and platform
- Architecture summary (1-2 paragraphs)
- Key patterns identified
- Notable observations (tech debt, inconsistencies, strengths)
- Suggested next steps (optional)

If bk-researcher was dispatched, incorporate research findings into summary.

Save analysis to `bk/dev/research/{topic}-analysis.md` if user wants to reference it later.

## Constraints

- No code changes — pure read-only exploration
- No FSM state machine — no `.workflow-state.json` updates
- No approval gates — fully automatic
- bk-researcher is optional, background (sonnet)
- Main session does the analysis directly using Grep/Glob/Read

## References

- Core rules (platform detection): `.claude/rules/core-rules.md`
- Platform rules: `.claude/rules/{ios,android,flutter}-rules.md`
