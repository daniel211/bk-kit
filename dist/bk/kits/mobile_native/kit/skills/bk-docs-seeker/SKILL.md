---
name: bk-docs-seeker
description: "Look up latest SDK docs for mobile frameworks via context7.com. Use before coding or debugging with unfamiliar APIs."
user-invocable: true
argument-hint: "[framework/library] [topic]"
triggers:
  - signal: unknown_api
    condition: "agent encounters unknown API/framework/method"
---

# SDK Docs Lookup: $ARGUMENTS

Fetch latest documentation for mobile frameworks and SDKs via context7.com llms.txt standard.

<Use_When>
- Before implementing with an unfamiliar mobile API (SwiftUI, Jetpack Compose, Flutter, UIKit, etc.)
- Debugging a framework-specific issue — check for breaking changes or deprecated APIs
- User asks "how to X in SwiftUI/Compose/Flutter"
- User says "look up docs for", "check API for", "latest docs on"
- Validating API usage before code review passes
</Use_When>

<Do_Not_Use_When>
- Internal project code questions — use /bk-scout
- General programming questions not tied to a specific SDK
- User wants to search the whole codebase — use /bk-context
- Planning or implementation already underway with known APIs
</Do_Not_Use_When>

## Step 1: Detect Topic

Run topic detection to extract library and topic from query:

```bash
node scripts/detect-topic.js "$ARGUMENTS"
```

- If output `isTopicSpecific: true` → proceed to Step 2 with topic
- If `isTopicSpecific: false` → proceed to Step 2 without topic (general lookup)
- If query matches a MOBILE_ALIASES key → resolve alias before lookup

Load: `references/mobile-sdk-mappings.json` for alias resolution.

## iOS Note: Xcode MCP Doc Search

On iOS projects with Xcode 26.3+ (macOS Sequoia+): if Xcode MCP is available, prefer MCP `doc-search` tool for Apple framework docs (SwiftUI, UIKit, SwiftData, Combine, etc.) — it queries Apple Developer Documentation directly with full project context.

Fallback to context7.com for:
- Third-party libraries (Alamofire, SnapKit, RxSwift, etc.)
- Frameworks not in Apple Developer Documentation
- When Xcode MCP is unavailable

## Step 2: Fetch Docs

```bash
node scripts/fetch-docs.js "$ARGUMENTS"
```

Fallback chain:
1. Try topic-specific URL: `https://context7.com/{org}/{repo}/llms.txt?topic={topic}`
2. Try general URL: `https://context7.com/{org}/{repo}/llms.txt`
3. If both fail → report not found, suggest web search

## Step 3: Analyze (Optional)

If result contains a large llms.txt listing (>10 URLs), run analyzer:

```bash
node scripts/analyze-llms-txt.js <content-file>
```

Use priority grouping to surface critical/important docs first.

## Step 4: Return Docs

Output the relevant documentation content directly. Include:
- Source URL
- Whether result is topic-specific or general
- Documentation content (truncated to relevant sections if large)
- If lookup failed: suggest alternative (web search, official docs link from `references/context7-mobile-patterns.md`)

## Constraints

- DO NOT modify any project files — read-only skill
- If ambiguous library name → use `AskUserQuestion` to clarify (e.g., "compose" could mean Jetpack Compose or Docker Compose)
- Prefer topic-specific lookup over general to reduce token overhead
- Always report the source URL so output is traceable
