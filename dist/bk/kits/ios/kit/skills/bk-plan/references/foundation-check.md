# Foundation Check

Check if project has been bootstrapped before planning.

## Check Logic

```
1. Glob("bk/docs/foundation/overview.md")
2. IF exists:
     Read bk/docs/foundation/overview.md → extract platform, structure
     Read bk/docs/foundation/architecture.md → extract patterns
     Read bk/docs/foundation/code-guidelines.md → extract conventions
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
| `bk/docs/foundation/overview.md` | platform, structure, entry points, totalLoc |
| `bk/docs/foundation/architecture.md` | arch pattern, state mgmt, DI, navigation, networking |
| `bk/docs/foundation/code-guidelines.md` | naming, folder structure, lint rules, test conventions |
| `bk/docs/foundation/dependencies.md` | available packages (know what's usable) |
| `bk/docs/foundation/build-targets.md` | build/test commands (for agents) |

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

## Full Extraction Detail (bk-plan Step 1)

If `bk/docs/foundation/overview.md` is missing → **STOP** and show:
"Foundation docs not found. Run `/bk-bootstrap` first to scan project."

If it exists, read ALL 6 foundation files and extract specific data:

1. `bk/docs/foundation/overview.md` → platform, entry points, module map
2. `bk/docs/foundation/architecture.md` → architecture pattern, state management, DI, layer map
3. `bk/docs/foundation/code-guidelines.md` → naming conventions, lint rules, test patterns
4. `bk/docs/foundation/dependencies.md` → core deps, version constraints
5. `bk/docs/foundation/build-targets.md` → build commands, CI config
6. `bk/docs/foundation/design-system.md` (if exists) → UI components, theming

Store the result as `foundation_context` for every subsequent step:

```
foundation_context = {
  platform, entryPoints, moduleMap,
  architecturePattern, stateManagement, di, layerMap,
  namingConventions, lintRules, testPatterns,
  coreDeps, versionConstraints,
  buildCommands, ciConfig,
  uiComponents, theming
}
```

Then load `platform-context.json`.

Pre-collected spec input: if `bk/dev/{feature}/spec-summary.md` exists, read it as pre-collected
input and skip interview questions for anything `/bk-spec` already gathered.
