# Serena Code Analysis

Serena MCP enhances code analysis with semantic understanding.
Use alongside Grep for precise blast radius and impact analysis.

## Tool Priority

Follow `rules/coding-intelligence-priority.md` for tool selection.
Serena is P1 for blast radius. If unavailable → P2 LSP → P3 Grep (never skip levels).

## Blast Radius with Serena

### Step 1: Keyword Search (Grep — unchanged)
```
Grep("{feature keywords}", glob: "*.{swift,kt,dart}")
→ List files mentioning the feature domain
→ Fast, accurate for text matching
```

### Step 2: Affected File Symbols (Serena enhancement)
For each matched file from Step 1:
```
serena get_symbols_overview(relative_path: "{affected-file}", depth: 1)
→ Exact classes/functions in the file
→ Know WHICH symbols need modification, not just "this file is affected"
```
Fallback: Read file + manually identify relevant sections

### Step 3: Blast Radius (Serena primary)
```
serena find_referencing_symbols(symbol_name: "{ModifiedClass}")
→ All files referencing this class with code snippets + symbol context
→ Covers: direct import, protocol conformance, type parameters, extensions
→ Result: precise blast radius without grep false positives
```

Fallback chain:
1. Serena find_referencing_symbols → precise semantic refs
2. Grep import statements → text-based, may include false positives

### Step 4: Interface→Implementation (Serena)
```
serena find_symbol(name_path_pattern: "{ProtocolName}", include_body: false)
→ Find protocol/interface definition

serena find_referencing_symbols(symbol_name: "{ProtocolName}")
→ Find concrete implementations that need updating
→ Equivalent to LSP goToImplementation but symbol-based (more reliable)
```
Fallback: grep "class.*:.*{ProtocolName}" + manual verification

## Example: "Add push notification support"

```
Grep: "notification" → 5 files match

serena get_symbols_overview("Sources/Services/NotificationService.swift", depth: 1):
  - class NotificationService
  - func registerForPushNotifications()
  - func handleRemoteNotification(userInfo:)
  - protocol NotificationDelegate

serena find_referencing_symbols("NotificationService"):
  - AppDelegate.swift:23 (initialization)
  - DIContainer.swift:45 (registration)
  - DeepLinkHandler.swift:12 (notification → deeplink routing)
  - SettingsViewModel.swift:67 (toggle notification)

Blast radius:
  Direct: NotificationService.swift, AppDelegate.swift
  Indirect: DIContainer, DeepLinkHandler, SettingsViewModel
  Risk: DeepLinkHandler shared utility → MEDIUM risk
```

## Plan Synthesis Enhancement

When generating expected code in plan phases:
```
serena find_symbol(name_path_pattern: "ExistingPattern", include_body: true)
→ Exact signature + types for reference
→ Expected code preview matches real types (not guessed)
```

File ownership verification:
```
serena find_referencing_symbols("{shared-file-class}")
→ Detect overlap: "DIContainer referenced by Phase 1 AND Phase 3" → flag conflict
```
