# LSP Analysis

Use Claude Code's built-in LSP tool for semantic code understanding.
Requires: `ENABLE_LSP_TOOL=1` environment variable.

## Availability Check

Before using LSP, test with a known file:
```
LSP(operation: "documentSymbol", filePath: "{entry-point}", line: 1, character: 1)
```
If error → fallback to Grep-only analysis. Note in output: "LSP unavailable, Grep-only scan."

## Useful Operations for Bootstrap

### documentSymbol — Class/function inventory
```
LSP(operation: "documentSymbol", filePath: "lib/main.dart", line: 1, character: 1)
→ Lists all classes, functions, variables in file
→ Use to verify architecture layer contents
```

### workspaceSymbol — Find all pattern instances
```
LSP(operation: "workspaceSymbol", filePath: "lib/main.dart", line: 1, character: 1)
→ Search: "Repository", "ViewModel", "UseCase", "Bloc"
→ Use to count and locate pattern implementations project-wide
```

### goToImplementation — Map abstract → concrete
```
LSP(operation: "goToImplementation", filePath: "{repo-interface}", line: {class-line}, character: 1)
→ Find concrete implementations of interfaces
→ Use to verify Repository pattern (abstract in domain/ → impl in data/)
```

### hover — Verify types and framework
```
LSP(operation: "hover", filePath: "{file}", line: {import-line}, character: {symbol-pos})
→ Get type info, documentation
→ Use to verify framework version, confirm pattern usage
```

## When to Use LSP vs Grep

| Scenario | Use |
|----------|-----|
| Count files importing X | Grep (faster) |
| List all classes in a file | LSP documentSymbol |
| Find all ViewModel subclasses | LSP workspaceSymbol |
| Verify interface has implementation | LSP goToImplementation |
| Check dependency version | Grep dep file (faster) |
| Understand class hierarchy | LSP (accurate) |

## External: Serena MCP

If Serena MCP server is configured, it provides deeper semantic code navigation:

| Serena Tool | LSP Equivalent | Advantage |
|-------------|---------------|-----------|
| `get_symbols_overview` | `documentSymbol` | Directory-level, includes hierarchy |
| `find_referencing_symbols` | `findReferences` | Symbol-based (no line/char positioning) |
| `find_symbol` | `goToImplementation` | Name-based lookup, more reliable |

Serena queries by **symbol name** (not file position) → more reliable than LSP position-based calls.

**Priority**: Serena > LSP built-in > Grep fallback.
See `references/serena-integration.md` for full tool reference and decision table.
