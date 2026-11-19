# Xcode MCP Build Error Shortcut (bk-debug)

If bug report contains Xcode build error output (from xcode-mcp or xcode-build MCP):
1. Parse error type from diagnostics:
   - Syntax error → route to `workflow-build.md`
   - Type mismatch → route to `workflow-build.md`  
   - Missing import → route to `workflow-build.md`
   - Linking error → route to `workflow-build.md`
2. Skip full classify scoring — use build error classification directly
3. Set tier based on error scope:
   - Single file error → Trivial
   - Multi-file / dependency error → Standard
   - Framework-level / linking → Complex

> This shortcut saves ~30% classify time for build errors with clear diagnostics.
