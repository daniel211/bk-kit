# Serena Integration for Bootstrap

Serena MCP provides semantic code understanding to complement Grep/Glob scan.
Serena is OPTIONAL — every step MUST have Grep/Glob fallback.

## Availability Check & Onboarding

```
IF serena tools exist in session (e.g. check_onboarding_performed, find_symbol):
  → Step 1: check_onboarding_performed()
  → Step 2: IF not onboarded:
      → activate_project(project: "{project-root}")
      → onboarding()  ← MUST call to index project symbols
  → Step 3: Set flag SERENA_AVAILABLE = true
ELSE:
  → SERENA_AVAILABLE = false
  → Continue with Grep/Glob only (current behavior)
```

**IMPORTANT:** `onboarding()` is what indexes the project for semantic tools.
Without it, `find_symbol`/`get_symbols_overview`/`find_referencing_symbols` won't work.
This step runs once per project — subsequent sessions skip via `check_onboarding_performed`.

## Tools for Bootstrap

### get_symbols_overview — Architecture Verification
```
serena get_symbols_overview(relative_path: "Sources/Features/Login/", depth: 1)
→ Returns: classes, protocols, functions in directory with children
→ Use: Verify architecture layers, class hierarchy, pattern adoption
→ Enriches: architecture.md detection with semantic evidence
```
Fallback: Grep class declarations + Read representative files

### find_referencing_symbols — Dependency Mapping
```
serena find_referencing_symbols(symbol_name: "BaseViewModel")
→ Returns: all files/classes referencing BaseViewModel with code snippets
→ Use: Map class hierarchy, count pattern adoption, verify interface→impl
→ Enriches: pattern detection evidence with cross-file relationships
```
Fallback: grep "BaseViewModel" + manual classification

### find_symbol — Definition Lookup
```
serena find_symbol(name_path_pattern: "AppDelegate", include_body: false)
→ Returns: exact file + line of class definition + signature
→ Use: Locate entry points, DI root, navigation root
```
Fallback: grep "class AppDelegate" / Glob("**/AppDelegate.swift")

## Decision Table: Serena vs Grep

| Detection Target | Grep | Serena | Use |
|-----------------|------|--------|-----|
| Import count (Riverpod in N files) | Fast, accurate | Overkill | **Grep** |
| Class hierarchy (ViewModel extends BaseVM) | Miss inheritance | Exact | **Serena if available** |
| Interface→Implementation map | Guess from naming | Exact via references | **Serena if available** |
| DI module structure | Partial | Full symbol map | **Serena if available** |
| File count, LOC | Only option | N/A | **Glob + Bash** |
| Config values (SDK version, lint rules) | Direct read | N/A | **Grep/Read** |
| Navigation graph (routes → screens) | Grep route patterns | Symbol references | **Serena if available** |

## Tool Priority

Follow `rules/coding-intelligence-priority.md` for tool selection order.
Serena is P1, LSP is P2, Grep is P3, Read is P4.
Never skip levels — if Serena unavailable, try LSP before falling to Grep.

Foreground sub-agents inherit MCP config. Background/parallel agents may not.
For parallel workflows, always implement P3/P4 fallback path.
