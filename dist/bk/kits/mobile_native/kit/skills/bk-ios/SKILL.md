---
name: bk-ios
description: "Swift/SwiftUI patterns + XCTest. Platform knowledge for bk-ios-developer."
user-invocable: false
---

# bk-ios Platform Knowledge

Code patterns for iOS with Swift/SwiftUI and XCTest.
**Read the matching reference before writing view or test code** — it holds the full,
copy-paste examples.

## House conventions

- **Views**: small composed `View` structs, state hoisted into the ViewModel; loading / error /
  empty states are explicit branches, never an implicit blank screen.
- **ViewModels**: `@Observable` (Swift 5.9+), use cases injected through the initializer,
  `@MainActor` on anything that mutates view state.
- **Navigation**: `NavigationStack` with a typed path enum — no ad-hoc `NavigationLink` chains.
- **Tests**: XCTest with `sut` naming, `setUp`/`tearDown`, `async` tests with `await`,
  `@MainActor` on view-model tests, and **fakes preferred over mocks**.

## References

- View composition, `@Observable` view models, NavigationStack, state views:
  `references/swiftui-patterns.md`
- Test setup, async tests, `@MainActor` tests, fake implementations: `references/xctest-patterns.md`
