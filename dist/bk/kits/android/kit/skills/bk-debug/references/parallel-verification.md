# Parallel Verification

Patterns for launching parallel agents to verify fixes.

## After Fix Implementation

Launch in SINGLE message:

### iOS
```
Agent("Bash", "xcodebuild -workspace App.xcworkspace -scheme App build", "Build check")
Agent("Bash", "swiftlint lint --quiet", "Lint check")
```

### Android
```
Agent("Bash", "./gradlew assembleDebug", "Build check")
Agent("Bash", "./gradlew lint", "Lint check")
```

### Cross-platform (if applicable)
```
Agent("Bash", "[iOS build command]", "iOS build")
Agent("Bash", "[Android build command]", "Android build")
```

## Before Commit

```
Agent("Bash", "[build command]", "Final build")
Agent("Bash", "[test command]", "Final tests")
```

## Resource Limits

- Max 3 parallel agents (system resources)
- Each subagent has 200K token context limit
- Keep prompts concise
