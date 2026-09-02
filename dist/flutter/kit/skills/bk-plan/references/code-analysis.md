# Code Analysis (Feature-Focused)

Scan codebase for feature-relevant files, affected code, and blast radius.
Broad project context comes from `mk/docs/foundation/` (bootstrap output).

## Prerequisites

Read from foundation (loaded in Step 1):
- `mk/docs/foundation/architecture.md` → known patterns, layers, key files
- `mk/docs/foundation/code-guidelines.md` → conventions to follow
- `mk/docs/foundation/dependencies.md` → available packages

If foundation missing → fallback to full scan (see Legacy Scan below).

## Feature-Specific Scan

### 1. Keyword Search

Grep for feature-related terms in source files:
```
Grep("{feature keywords}", glob: "*.{swift,kt,dart}")
→ List files that mention the feature domain
→ These are the affected files
```

### 2. Affected Files

For each matched file:
- File path + line numbers of relevant code
- What will be modified and why
- Actual code snippet (5-15 lines) showing current pattern

### 3. Blast Radius

Using foundation's layer map + feature grep results:
- **Direct**: files this feature modifies
- **Indirect**: files that import/depend on modified files
  - PRIMARY: Serena `find_referencing_symbols` (if available) → precise semantic refs
  - SECONDARY: LSP `findReferences` (if available)
  - FALLBACK: Grep import statements
- **Risk areas**: shared utilities, base classes, DI registration

### 4. Semantic Deep Dive (Serena primary, LSP secondary)

For complex features, use Serena for accurate impact analysis:
```
serena find_referencing_symbols(symbol_name: "{modified-class}")
→ Find all callers/users — precise, no false positives

serena find_symbol(name_path_pattern: "{interface}", include_body: false)
→ Find concrete classes that need updating
```

Follow `rules/coding-intelligence-priority.md` for fallback chain:
P1 Serena → P2 LSP → P3 Grep (never skip levels).

See `references/serena-code-analysis.md` for Serena workflow.
See `@bk-bootstrap/references/lsp-analysis.md` for LSP details.

## Gap Detection

Flag gaps found during analysis:
- Missing base class → "Base class not found, may need creation"
- Shared interceptor change → "Affects {N} consumers"
- No existing pattern for this feature type → "New pattern needed"

Report gaps with severity (CRITICAL/HIGH/MEDIUM/LOW).

## Output

Write to `{plan-dir}/research/code-analysis-summary.md`:

```markdown
# Code Analysis: {feature}

## Foundation Context
- Architecture: {from mk/docs/foundation/architecture.md}
- Patterns: {relevant patterns for this feature}

## Affected Files
| File | Lines | Change Type | Reason |
|------|-------|-------------|--------|

## Blast Radius
- Direct: {N} files
- Indirect: {N} files
- Risk: {high/medium/low}

## Existing Code Snippets
{actual code from affected files}

## Gaps
- [{severity}] {description}
```

## Legacy Scan (no foundation)

If `mk/docs/foundation/` missing and user skipped bootstrap:
- Detect platform from file signals (pubspec.yaml/xcworkspace/build.gradle)
- Grep for architecture patterns (ViewModel, Repository, UseCase)
- Grep for DI, navigation, networking patterns
- This is slower and less accurate than foundation-based analysis
