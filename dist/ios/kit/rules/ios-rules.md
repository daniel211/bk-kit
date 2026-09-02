# iOS Platform Rules

## Language & Conventions
- Swift 5.9+ (latest stable)
- PascalCase: types, protocols, enums
- camelCase: variables, functions, parameters
- File named after primary type: UserProfileView.swift, LoginViewModel.swift

## UI Framework
- SwiftUI preferred for new screens
- UIKit for legacy or complex custom UI
- Do not mix SwiftUI + UIKit in same screen (except hosting)
- @ViewBuilder for composable views
- PreviewProvider for every View

## Concurrency
- async/await preferred over completion handlers
- Structured concurrency with TaskGroup for parallelism
- @MainActor for UI updates
- Sendable conformance for shared types

## Dependencies
- Swift Package Manager (SPM) preferred
- CocoaPods only when library lacks SPM support
- Minimize dependencies — prefer Apple frameworks

## Project Structure
```
App/
├── Sources/
│   ├── App/              # App delegate, DI container
│   ├── Features/
│   │   ├── Auth/
│   │   │   ├── Views/
│   │   │   ├── ViewModels/
│   │   │   └── Models/
│   │   └── Home/
│   ├── Core/
│   │   ├── Network/
│   │   ├── Storage/
│   │   └── Extensions/
│   └── Resources/
├── Tests/
└── UITests/
```

## Build & Test Commands
- Build: `xcodebuild -scheme App -sdk iphonesimulator build`
- Test: `xcodebuild test -scheme App -destination 'platform=iOS Simulator,name=iPhone 16'`
- Lint: `swiftlint lint --strict`
- Format: `swiftformat .`

## MCP Integration
- Xcode MCP (Xcode 26.3+, macOS Sequoia+) is preferred for build/test/preview when available
- Use MCP `build` and `test` tools before falling back to xcodebuild CLI
- Use MCP `preview-capture` for automated SwiftUI visual verification (integrates with bk-visual-verify)
- Use MCP `doc-search` for Apple framework docs (preferred over context7 for native Apple APIs)
- Use MCP `error-diagnose` for structured compiler diagnostic parsing
- Fallback to xcodebuild CLI if MCP unavailable
- See `skills/_base/bk-code/references/xcode-mcp-tools.md` for decision table and full tool catalog
