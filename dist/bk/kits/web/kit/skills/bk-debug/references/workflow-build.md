# Build Fix Workflow

For Xcode/Gradle/CMake build failures, linking errors, dependency resolution issues.

## Detection Keywords
`build`, `compile`, `link`, `pod`, `gradle`, `xcode`, `swift build`, `CocoaPods`, `SPM`, `dependency`, `module not found`

## Workflow

### Step 1: Capture Build Output
```bash
# iOS — prefer Xcode MCP error-diagnose if available (Xcode 26.3+, macOS Sequoia+)
# MCP: use error-diagnose tool for structured diagnostics
# Bash fallback:
xcodebuild -workspace App.xcworkspace -scheme App build 2>&1 | tail -50
# Android
./gradlew assembleDebug 2>&1 | tail -50
```

### Step 2: Classify Build Error

| Type | Indicators | Common Fix |
|------|-----------|-----------|
| Missing module | `No such module`, `Cannot find` | Check dependency manager (SPM/CocoaPods/Gradle) |
| Linking | `Undefined symbols`, `duplicate symbol` | Check target membership, link flags |
| Syntax/Type | `Type X has no member Y`, `Cannot convert` | Code fix in affected file |
| Version mismatch | `Minimum deployment target`, `SDK version` | Update project settings |
| Dependency | `Pod install`, `Could not resolve`, `version conflict` | Update lockfile, resolve versions |

### Step 3: Fix
- Fix build config/code per classification
- Re-run build command to verify

### Step 4: Verify
- Clean build: `xcodebuild clean build` / `./gradlew clean assembleDebug`
- If fail → retry (max 3 per `rules/approval-rules.md`)

## Notes
- Always clean build after dependency changes
- Check both Debug and Release configurations
- For CocoaPods: `pod install --repo-update` before giving up
