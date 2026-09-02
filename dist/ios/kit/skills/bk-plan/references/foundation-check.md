# Foundation Check

Check if project has been bootstrapped before planning.

## Check Logic

```
1. Glob("mk/docs/foundation/overview.md")
2. IF exists:
     Read mk/docs/foundation/overview.md → extract platform, structure
     Read mk/docs/foundation/architecture.md → extract patterns
     Read mk/docs/foundation/code-guidelines.md → extract conventions
     → Use as base context for planning
     → Skip own platform detection
     → Skip broad code analysis (do feature-specific only)
3. IF missing:
     Notify user: "Project not bootstrapped yet."
     Ask via AskUserQuestion:
       - "Run /bk-bootstrap now?" → execute bootstrap inline → continue
       - "Skip, use basic detection" → fallback to Grep-based detection
4. IF exists but stale (check frontmatter `generated` date):
     Warn: "Foundation docs from {date}. Consider /bk-bootstrap --refresh"
     Continue with existing data
```

## What to Read

| File | Extract For |
|------|-------------|
| `mk/docs/foundation/overview.md` | platform, structure, entry points, totalLoc |
| `mk/docs/foundation/architecture.md` | arch pattern, state mgmt, DI, navigation, networking |
| `mk/docs/foundation/code-guidelines.md` | naming, folder structure, lint rules, test conventions |
| `mk/docs/foundation/dependencies.md` | available packages (know what's usable) |
| `mk/docs/foundation/build-targets.md` | build/test commands (for agents) |

## Context Passed to Downstream Steps

After reading foundation, populate planning context:

```
planContext:
  platform: {from overview}
  architecture: {from architecture}
  conventions: {from code-guidelines}
  availablePackages: {from dependencies — names only, not versions}
  buildCommands: {from build-targets — for test/lint verification}
```

## Serena Cross-Validation (if available)

If Serena MCP is available, cross-validate foundation data:
```
serena get_symbols_overview(relative_path: "{main-source-dir}/", depth: 0)
→ Compare symbol inventory against architecture.md patterns
→ Flag if foundation docs are stale (e.g., new patterns adopted since bootstrap)
```
This is a quick sanity check, not a full re-scan. If stale → warn user, suggest `--refresh`.

## Context Passed to Downstream Steps

This context feeds into:
- Step 5 (code-analysis) → knows patterns, skips broad scan
- Step 6 (researchers) → accurate platform/arch context in prompts
- Step 8 (synthesis) → expected code follows detected conventions
