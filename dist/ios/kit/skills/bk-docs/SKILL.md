---
name: bk-docs
description: "Documentation workflow — init, update, or summarize project bk/docs/ via bk-docs-writer."
user-invocable: true
argument-hint: "[--init | --summarize | feature or scope to document]"
---

# Generate Docs: $ARGUMENTS

Dispatches bk-docs-writer (background, sonnet) to manage project documentation.
Three modes: `--init` (scaffold full docs set), `--summarize` (audit docs status), or default update mode.
Output goes to `bk/docs/` directory. No code changes — docs only.

<Use_When>
- User wants to update documentation after implementing a feature
- User says "document", "update docs", "write docs", "generate docs"
- User says "init docs", "setup docs", "scaffold docs" → use `--init`
- User says "docs status", "what docs exist", "docs summary" → use `--summarize`
- After commit, as a documentation step
- User invokes `/bk-docs [--init | --summarize | feature or scope]`
</Use_When>

<Do_Not_Use_When>
- Code review needed — use /bk-code-review
- Implementation needed first — use /bk-code
</Do_Not_Use_When>

## Approval Gates

Auto-approve — no user gate required.

## Subcommands

### `--init` — Scaffold Initial Docs

Scan the codebase and generate a complete initial documentation set in `bk/docs/`:

1. **Scan**: Use Glob/Grep/Read to analyze project structure, dependencies, entry points, patterns
2. **Generate** these files (skip any that already exist unless empty):
   - `bk/docs/project-overview-pdr.md` — project purpose, goals, tech stack
   - `bk/docs/code-standards.md` — detected patterns, naming conventions, architecture rules
   - `bk/docs/codebase-summary.md` — directory structure, key modules, entry points
   - `bk/docs/system-architecture.md` — component diagram, data flow, integrations
   - `bk/docs/design-guidelines.md` — UI/UX patterns, theme, component library
   - `bk/docs/deployment-guide.md` — build, test, deploy instructions
3. **Report**: List files created/skipped, coverage gaps

Dispatch:
```
Task(subagent_type: "bk-docs-writer", model: "sonnet", run_in_background: true, prompt: "
  Mode: init
  Platform: {platform}
  Scan entire codebase. Generate initial docs set in bk/docs/.
  Skip files that already exist with content. Output: new files in bk/docs/
")
```

### `--summarize` — Audit Docs Status

Quick read-only audit of current documentation:

1. **Check existence**: List which of the 6 standard docs files exist in `bk/docs/`
2. **Check freshness**: Compare each doc's last-modified date against recent git commits touching related code
3. **Identify gaps**: Flag missing files, empty sections, stale content (>30 commits behind)
4. **Output table**:
   ```
   File                       | Status   | Last Updated | Staleness
   project-overview-pdr.md    | exists   | 2026-03-10   | fresh
   code-standards.md          | exists   | 2026-02-15   | stale (47 commits behind)
   design-guidelines.md       | MISSING  | —            | —
   ```

No files are modified in this mode. Report only.

---

## Execution (Default Update Mode)

### Step 1: Resolve Context

Parse `$ARGUMENTS` for feature name or documentation scope.
Detect platform from project files. Load platform context from `config/platform-context.{platform}.json`.

Gather context for bk-docs-writer:
- `bk/dev/shared/{platform}/{feature}-impl-result.json` — what was implemented
- `bk/dev/shared/reports/code-review-{feature}.json` and/or `code-review-gemini-{feature}.json` — review findings (if exists)
- Current `bk/docs/` structure: `codebase-summary.md`, `system-architecture.md`, `code-standards.md`

### Step 2: Dispatch bk-docs-writer

Dispatch bk-docs-writer background (sonnet):
```
Task(subagent_type: "bk-docs-writer", model: "sonnet", run_in_background: true, prompt: "
  Feature: {feature_name}
  Platform: {platform}
  impl-result: bk/dev/shared/{platform}/{feature}-impl-result.json
  Existing docs to update:
    - bk/docs/codebase-summary.md
    - bk/docs/system-architecture.md  (if architecture changed)
    - bk/docs/code-standards.md       (if new patterns introduced)
  Output: updated files in bk/docs/ directory
")
```

bk-docs-writer reads implementation context and updates relevant docs sections without
overwriting unrelated content.

### Step 3: Report Changes

Show user:
- Files updated in `bk/docs/`
- Sections added or modified
- Docs impact: none | minor | major
- Any documentation gaps identified

## Output

Updated files in `bk/docs/`:
- `bk/docs/codebase-summary.md` — always reviewed
- `bk/docs/system-architecture.md` — updated if architecture/data flow changed
- `bk/docs/code-standards.md` — updated if new patterns introduced

## Documentation Trigger Rules

Auto-update docs when these events occur (agent or user should invoke `/bk-docs` accordingly):

| Trigger | Scope | Priority |
|---------|-------|----------|
| Feature implemented | codebase-summary, system-architecture | high |
| Major milestone completed | project-overview-pdr, codebase-summary | high |
| Bug fix with architectural impact | system-architecture, code-standards | medium |
| New patterns/conventions introduced | code-standards | medium |
| Build/deploy process changed | deployment-guide | medium |
| UI/theme changes | design-guidelines | low |
| Security patch applied | deployment-guide, system-architecture | high |

After triggering, report docs impact as: `none | minor | major`.

## Constraints

- Auto-approve — no user gate required
- bk-docs-writer is background (sonnet) — uses Grep/Glob/Read for context, Write for output
- Never delete existing documentation — only add or update sections
- `--init` skips files that already exist with content
- `--summarize` is read-only — never modifies files
- Documentation management rules: `rules/documentation-management.md`
