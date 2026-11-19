# Coding Intelligence Priority

```
P1: Serena MCP     → semantic, symbol-based (class hierarchy, cross-file refs)
P2: LSP Plugin     → semantic, position-based (documentSymbol, findReferences)
P3: Grep/Glob      → text pattern matching (fast counts, file discovery)
P4: Read/Explore   → manual file reading (last resort, full content)
```

## Availability Detection (run once per session)

```
1. "serena" in MCP servers? → Yes: activate_project → SERENA=true; No: SERENA=false
2. ENABLE_LSP_TOOL=1 in env? → Yes: test documentSymbol → LSP=true/false; No: LSP=false
3. Grep/Glob: always available
4. Read/Explore: always available
```

## Decision Matrix

| Task | P1 Serena | P2 LSP | P3 Grep | P4 Read |
|------|-----------|--------|---------|---------|
| Count files importing X | skip | skip | **USE** | skip |
| File/dir discovery | skip | skip | **USE** | skip |
| Read config values | skip | skip | **USE** | fallback |
| Class hierarchy | **USE** | fallback | noisy | last resort |
| Interface → Implementation | **USE** | fallback | guess | last resort |
| All references to symbol | **USE** | fallback | noisy | skip |
| DI module graph | **USE** | fallback | partial | last resort |
| Navigation graph | **USE** | fallback | partial | last resort |
| Symbol inventory of file/dir | **USE** | fallback | skip | fallback |
| Understand code logic | skip | skip | skip | **USE** |
| Verify types/signatures | **USE** | fallback | skip | fallback |

- Grep for **text counting** and **file discovery** — always fastest
- Serena/LSP for **relationships** and **hierarchy** — semantic accuracy
- Read for **understanding logic** — when you need to comprehend code behavior
- Never Read-then-guess when a semantic tool can give exact answer

## Fallback Protocol

```
TRY P1 (Serena) → if unavailable/error:
TRY P2 (LSP)    → if unavailable/error:
TRY P3 (Grep)   → if insufficient:
USE P4 (Read)
```

Do NOT skip levels. Log which level was used: "Source: Serena semantic" / "Source: Grep pattern" / etc.

MCP failures auto-detected by `mcp-health-monitor.cjs` — injects `[MCP-FALLBACK]` guidance. Conductor does not need to handle manually.
