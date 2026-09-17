---
name: bk-flutter-sdk
description: "Dart/Flutter patterns + flutter_test/mocktail. Platform knowledge for bk-flutter-developer."
user-invocable: false
---

# bk-flutter-sdk Platform Knowledge

Code patterns for Flutter with BLoC/Riverpod state management and flutter_test/mocktail.
**Read the matching reference before writing state-management or test code** — it holds the
full, copy-paste examples.

## House conventions

- **State**: BLoC with `sealed class` events + states and exhaustive `switch` in `BlocBuilder`;
  or Riverpod `Provider` / `FutureProvider.family` / `AsyncNotifier` with `AsyncValue.guard`.
  Widgets: `BlocProvider` + `BlocBuilder`, or `ConsumerWidget` + `ref.watch(...).when(...)`.
- **Repositories** are injected into the BLoC/Notifier, never constructed inside it.
- **Errors** surface as a state (`UserError`) — never a thrown exception reaching the widget tree.
- **Tests**: `mocktail` mocks (`when(() => ...).thenAnswer`), `bloc_test` for BLoC,
  `ProviderContainer(overrides: [...])` for Riverpod, `testWidgets` for widget tests, and
  fakes (a real in-memory implementation) in preference to mocks where state matters.
- Golden tests via `matchesGoldenFile` for stable, layout-critical screens.

## References

- BLoC vs Riverpod decision table, Cubit, and full state-management examples:
  `references/bloc-riverpod-patterns.md`
- Unit, widget, golden, bloc_test and Riverpod test examples: `references/flutter-test-patterns.md`
