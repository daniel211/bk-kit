---
name: bk-android
description: "Kotlin/Compose patterns + JUnit5/MockK. Platform knowledge for bk-android-developer."
user-invocable: false
---

# bk-android Platform Knowledge

Code patterns for Android with Kotlin/Jetpack Compose and JUnit5/MockK.
**Read the matching reference before writing composable or test code** — it holds the full,
copy-paste examples.

## House conventions

- **Composables**: state hoisting — a composable takes state + callbacks, never owns business
  state; `@Preview` for every screen-level composable.
- **ViewModels**: `MutableStateFlow` private + `StateFlow` public via `asStateFlow()`,
  updates through `viewModelScope`, UI state as a single data class.
- **Navigation**: Compose Navigation with typed routes.
- **Tests**: JUnit5 + MockK (`mockk`, `coEvery`, `coVerify`), Turbine for Flow assertions,
  `runTest` + a test dispatcher for coroutines, and fakes where a real in-memory implementation
  reads better than a mock.

## References

- State hoisting, StateFlow view models, previews, navigation: `references/compose-patterns.md`
- Test setup, Turbine flow tests, coroutine tests, fakes: `references/junit-mockk-patterns.md`
