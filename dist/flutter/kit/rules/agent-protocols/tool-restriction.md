---
paths:
  - .claude/agents/**
---

# Tool Restriction Protocol

> Enforce tool boundaries per agent type. Read-only agents MUST NOT use Edit or Bash.

## Agent Tool Categories

| Category | Agents | Allowed Tools | Forbidden Tools |
|----------|--------|---------------|-----------------|
| **Read-only** | bk-code-reviewer, bk-security-auditor, bk-performance-analyzer, bk-test-architect | Read, Grep, Glob, Write (reports only) | Edit, Bash, Task |
| **Write+Run** | bk-unit-test-agent | Read, Write, Edit, Grep, Glob, Bash | Task |
| **Write** | bk-device-test-agent | Read, Write, Edit, Grep, Glob | Bash, Task |
| **Full dev** | bk-ios-developer, bk-android-developer, bk-flutter-developer | Read, Write, Edit, Bash, Grep, Glob | Task |
| **Edit+util** | bk-docs-writer | Read, Edit, Write, Glob, Grep | Bash, Task |
| **Diag** | bk-debugger | Read, Bash, Glob, Grep | Edit, Task |
| **Utility** | bk-git-manager, bk-researcher | Read, Write, Grep, Glob, Bash | Task |
| **Planning** | bk-planner | Read, Glob, Grep, Bash | Task |
| **Design** | design-validator, design-spec-writer, design-asset-exporter | Read, Grep, Glob, Write, Bash | Edit, Task |
| **Read-only+Web** | bk-brainstormer | Read, Glob, Grep, WebSearch, WebFetch, Write (reports only) | Edit, Bash, Task |
| **Write+Run** | bk-code-simplifier | Read, Edit, Write, Bash, Glob, Grep | Task |
| **Coordination** | bk-project-manager | Read, Write, Glob, Grep | Edit, Bash, Task |

## Enforcement

### In Agent Definitions

Read-only agents MUST include:
```
FORBIDDEN TOOLS: Edit, Bash, Task
If you need to modify code, report the need in your output — do not modify directly.
```

### In Dispatch Prompts

When dispatching read-only agents:
```
TOOL RESTRICTION: You are a READ-ONLY agent. Do NOT use Edit, Bash, or Task tools.
Write your report to the output file using the Write tool only.
```

### Hook Enforcement

`verify-output.cjs` enforces tool restrictions:
1. Scans agent output for Edit/Bash patterns for read-only agents → `[TOOL-RESTRICT]` error
2. Second layer on top of `permissionMode: plan` in agent frontmatter
