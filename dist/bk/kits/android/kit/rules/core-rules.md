# beer-kit v2 — Core Rules

> Essential rules for orchestration. Agent-specific rules in agent definitions.

## 1. PROJECT TYPE DETECTION

| Type | Detection | Agent Dispatch |
|------|-----------|----------------|
| flutter | `pubspec.yaml` exists | bk-flutter-developer |
| flutter-with-native | `pubspec.yaml` + native code in ios/android | bk-flutter-developer |
| ios-only | `.xcworkspace`/`.xcodeproj`, no `android/`, no macOS target | bk-ios-developer |
| ipados-iphone | `.xcworkspace`/`.xcodeproj` with iPad deployment target | bk-ios-developer |
| macos-only | `.xcworkspace`/`.xcodeproj` with macOS target only | bk-ios-developer |
| apple-multiplatform | `.xcworkspace`/`.xcodeproj` with iOS + macOS targets | bk-ios-developer |
| android-only | `build.gradle`, no `ios/` | bk-android-developer |
| monorepo | Both `ios/` + `android/` (no pubspec.yaml) | bk-ios-developer (ios kit; composite mobile kit is future work) |
| fullstack | python + web markers at root or a first-level subdir | bk-python-developer + bk-web-developer |
| python | `pyproject.toml` / `requirements.txt` / `manage.py` / `setup.py` | bk-python-developer |
| web | `package.json` + `tsconfig.json` / `next.config.*` / `vite.config.*` | bk-web-developer |

Platform context: `.claude/platform-context.json`. Conventions: `.claude/rules/{platform}-rules.md`.

Fullstack: one sub-task per component (`components[]`: root, platform), dispatched to that component's
dev agent; backend + frontend sub-tasks run in parallel when their `Files:` don't overlap; an API contract
change = backend sub-task first, frontend after it (see `fullstack-rules.md`).

## 2. COMMAND ROUTING

| Command | Type | Agents | Post-tasks |
|---------|------|--------|-----------|
| /bk-code | FSM | bk-{platform}-developer | review + test |
| /bk-debug | FSM | bk-{platform}-developer | review + test |
| /bk-refactor | FSM | bk-{platform}-developer | test |
| /bk-plan | Hook | bk-planner | — |
| /bk-test | Hook | bk-test-architect, bk-unit-test-agent | — |
| /bk-review | Hook | bk-code-reviewer | — |
| /bk-commit | Hook | bk-git-manager | — |
| /bk-docs | Hook | bk-docs-writer | — |
| /bk-analyze | Skill | bk-researcher | — |

FSM commands follow state-machine.md. Hook-guarded commands enforce I/O via hooks.

## 3. PLATFORM STANDARDS

See the shared rule this kit ships in `.claude/rules/`: `mobile-shared-rules.md` (ios/android/flutter),
`backend-shared-rules.md` (python), `web-shared-rules.md` (web) or both (fullstack) — architecture, API, security, UI/UX or
observability, testing, CI/CD, git.

## 4. Agent Dispatch → See conductor-role.md §2-2B

## 5. BEHAVIORAL RULES

- Do what was asked; nothing more, nothing less
- Never continuously check agent status after dispatch — wait for Task tool results
- Never create files unless explicitly needed
- Always read before editing
- Main session orchestrates only: detect → dispatch → collect → commit

## 6. DETAILED RULES

- Conductor role: `.claude/rules/conductor-role.md`
- State machine: `.claude/rules/state-machine.md`
- Approval gates: `.claude/rules/approval-rules.md`
- Dispatch labeling: `.claude/rules/dispatch-labeling.md`
- Agent protocols: `.claude/rules/agent-protocols/`
- Platform rules: `.claude/rules/{platform}-rules.md` (fullstack: python + web + fullstack)
