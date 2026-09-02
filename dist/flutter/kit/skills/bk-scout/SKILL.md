---
name: bk-scout
description: "Fast codebase scouting using parallel agents. Use for file discovery, task context gathering, quick searches across mobile project directories."
version: 1.0.0
argument-hint: "[search-target]"
---

# Scout

Fast, token-efficient codebase scouting using parallel Explore subagents to find files needed for tasks.

## Arguments
- Default: Scout using built-in Explore subagents in parallel (`./references/internal-scouting.md`)

## When to Use

- Beginning work on feature spanning multiple directories
- User mentions needing to "find", "locate", or "search for" files
- Starting debugging session requiring file relationships understanding
- User asks about project structure or where functionality lives
- Before changes that might affect multiple codebase parts

## Quick Start

1. Analyze user prompt to identify search targets
2. Use a wide range of Grep and Glob patterns to find relevant files and estimate scale of the codebase
3. Spawn parallel agents with divided directories
4. Collect results into concise report

## Workflow

### 1. Analyze Task
- Parse user prompt for search targets
- Identify key directories, patterns, file types, lines of code
- Determine optimal SCALE value of subagents to spawn

### 2. Divide and Conquer
- Split codebase into logical segments per agent
- Assign each agent specific directories or patterns
- Ensure no overlap, maximize coverage

**Mobile directory patterns:**

iOS:
- `Sources/` - Swift source files
- `Modules/` - Feature modules
- `Services/` - Service layer
- `Extensions/` - Swift extensions
- `Resources/` - Assets, strings, plists
- `*.xcodeproj/` - Project configuration

Android:
- `app/src/main/` - Main source set
- `app/src/test/` - Unit tests
- `data/` - Data layer (repositories, datasources)
- `domain/` - Domain layer (use cases, models)
- `presentation/` - UI layer (ViewModels, fragments, activities)

Flutter:
- `lib/src/` - Core source
- `lib/features/` - Feature modules
- `test/` - Unit and widget tests
- `integration_test/` - Integration tests

### 3. Register Scout Tasks
- **Skip if:** Agent count ≤ 2 (overhead exceeds benefit)
- `TaskList` first — check for existing scout tasks in session
- If not found, `TaskCreate` per agent with scope metadata
- See `references/task-management-scouting.md` for patterns and examples

### 4. Spawn Parallel Agents
Load reference:
- **Internal (Default):** `references/internal-scouting.md` (Explore subagents)

**Notes:**
- `TaskUpdate` each task to `in_progress` before spawning its agent
- Prompt detailed instructions for each subagent with exact directories or files it should read
- Remember that each subagent has less than 200K tokens of context window
- Amount of subagents to-be-spawned depends on the current system resources available and amount of files to be scanned
- Each subagent must return a detailed summary report to a main agent

### 5. Collect Results
- Timeout: 3 minutes per agent (skip non-responders)
- `TaskUpdate` completed tasks; log timed-out agents in report
- Aggregate findings into single report
- List unresolved questions at end

## Report Format

```markdown
# Scout Report

## Relevant Files
- `path/to/file.swift` - Brief description
- ...

## Unresolved Questions
- Any gaps in findings
```

## References

- `references/internal-scouting.md` - Using Explore subagents
- `references/task-management-scouting.md` - Claude Task patterns for scout coordination
