---
name: bk-repomix
description: "Pack mobile project into LLM-optimized file with platform-aware presets. Use for onboarding, planning, code review context."
user-invocable: true
argument-hint: "[--preset ios|android|flutter|full] [--style xml|markdown] [--include pattern] [path]"
triggers:
  - signal: codebase_context_needed
    condition: "agent needs broader codebase understanding"
---

# Pack Project: $ARGUMENTS

Pack mobile codebase into a single LLM-readable file using repomix with mobile-optimized presets.

<Use_When>
- Onboarding a new project (before running /bk-bootstrap)
- Planning a large feature — need full codebase context for /bk-plan
- Preparing code review context for /bk-code-review
- Sharing codebase with external AI tool
- Estimating token budget before a large analysis task
</Use_When>

<Do_Not_Use_When>
- Looking up a specific file — use /bk-scout
- Reading a small set of files — use Read tool directly
- Documentation lookup — use /bk-docs-seeker
- Single-file analysis — no need to pack entire project
</Do_Not_Use_When>

## Step 1: Detect Platform

If `--preset` not specified, auto-detect from project files:

| Signal File | Platform |
|-------------|----------|
| `Package.swift` or `*.xcodeproj` | ios |
| `build.gradle` or `build.gradle.kts` | android |
| `pubspec.yaml` | flutter |
| Multiple signals | full |

## Step 2: Select Preset

Load preset details from `references/mobile-presets.md`.

| Preset | Include | Exclude |
|--------|---------|---------|
| `ios` | `**/*.swift,**/*.xib,**/*.storyboard,**/*.plist,Package.swift` | `Pods/,*.xcodeproj/xcuserdata/,DerivedData/,build/,.build/` |
| `android` | `**/*.kt,**/*.java,**/*.xml,build.gradle*,*.toml` | `build/,.gradle/,*.apk,*.aab,.idea/` |
| `flutter` | `lib/**/*.dart,pubspec.yaml,test/**/*.dart` | `.dart_tool/,build/,.flutter-plugins*` |
| `full` | All above combined | All above excludes combined |

Confirm preset with user if auto-detected (use `AskUserQuestion`):
> "Detected iOS project. Using `--preset ios`. Proceed?"

## Step 3: Run Repomix

Check repomix is installed:
```bash
repomix --version || npm install -g repomix
```

Build and run command from selected preset:

```bash
# Example for ios preset, xml style (default)
repomix \
  --include "**/*.swift,**/*.xib,**/*.storyboard,**/*.plist,Package.swift" \
  -i "Pods/,*.xcodeproj/xcuserdata/,DerivedData/,build/,.build/" \
  --style xml \
  --remove-comments \
  -o repomix-output.xml

# Example for markdown style
repomix \
  --include "**/*.swift,**/*.xib,**/*.storyboard,**/*.plist,Package.swift" \
  -i "Pods/,*.xcodeproj/xcuserdata/,DerivedData/,build/,.build/" \
  --style markdown \
  -o repomix-output.md
```

Default style: `xml` (best for structured LLM parsing).
Override with `--style markdown` or `--style plain`.

## Step 4: Report Results

After repomix completes, report:

```
Preset:       ios
Output:       repomix-output.xml
Token count:  ~42,500 tokens
Style:        xml
Files packed: 87

Excluded: Pods/ (would have added ~180K tokens)

Next steps:
- Feed to /bk-plan for feature planning
- Feed to /bk-code-review for full review
- Check token count fits target LLM context window
```

Token budget reference:
- Claude Sonnet: ~200K tokens — full preset usually fits
- GPT-4: ~128K tokens — use platform-specific preset
- If over budget: use `--include` to narrow scope further

## Constraints

- Always run security check (default on) — never disable unless user explicitly requests
- Never pack `.env` files — repomix respects `.gitignore` by default
- If output > 150K tokens, warn user and suggest narrowing with `--include`
- DO NOT commit repomix output files to git
