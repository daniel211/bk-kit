# Parallel Exploration Patterns

## Parallel Explore (Scouting)

Launch 2-3 Explore subagents simultaneously in ONE message:

```
Task(subagent_type: "Explore", run_in_background: true, prompt: "
  Find [X] in [area1]
", description: "Scout area1")

Task(subagent_type: "Explore", run_in_background: true, prompt: "
  Find [Y] in [area2]
", description: "Scout area2")
```

### Use Cases

| Scenario | Scout Prompts |
|----------|---------------|
| Root cause unclear | "Find error patterns in {module}", "Find recent changes to {files}" |
| Multi-module fix | "Find {module1} code", "Find {module2} code" |
| Impact analysis | "Find consumers of {API}", "Find tests for {module}" |

## Parallel Bash (Verification)

Launch parallel Bash agents for build verification:

```
Task(subagent_type: "Bash", run_in_background: true, prompt: "
  Run: {build_command} — report pass/fail
", description: "Verify build")

Task(subagent_type: "Bash", run_in_background: true, prompt: "
  Run: {lint_command} — report issues
", description: "Verify lint")
```

### Platform Build Commands

| Platform | Build | Test | Lint |
|----------|-------|------|------|
| iOS | `xcodebuild -scheme App -sdk iphonesimulator build` | `xcodebuild test ...` | `swiftlint lint --strict` |
| Android | `./gradlew assembleDebug` | `./gradlew test` | `./gradlew ktlintCheck detekt` |
| Flutter | `flutter build apk --debug` | `flutter test --coverage` | `dart analyze` |

## Resource Limits

- Max 3 parallel agents recommended
- Each subagent has 200K token context limit
- Keep prompts concise — avoid context bloat
- ALL parallel agents in ONE message (single-message batching)
