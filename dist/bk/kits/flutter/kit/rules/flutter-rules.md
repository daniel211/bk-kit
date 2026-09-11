# Flutter Platform Rules

## Language & Conventions
- Dart (latest stable)
- snake_case: files, variables, functions, parameters
- PascalCase: classes, enums, typedefs, extensions
- lowerCamelCase: constants
- File named after primary widget/class: user_profile_screen.dart, login_bloc.dart

## State Management
- Choose one per project: BLoC / Riverpod / Provider
- Separate UI state from business logic
- Immutable state classes (freezed or manual copyWith)

## Widget Patterns
- Composition over inheritance
- Extract widgets > 50 lines into separate file
- Const constructors when possible
- Keys for list items (ValueKey / ObjectKey)
- Sliver-based scrolling for complex layouts

## Dependencies
- pub.dev packages, check scores before adding
- Minimize dependencies
- Pin versions in pubspec.yaml
- Prefer official Flutter/Dart packages

## Project Structure
```
lib/
├── app/                    # App config, routes, theme
├── features/
│   ├── auth/
│   │   ├── screens/
│   │   ├── bloc/           # or providers/
│   │   ├── models/
│   │   └── repositories/
│   └── home/
├── core/
│   ├── network/
│   ├── storage/
│   ├── widgets/            # Shared widgets
│   └── extensions/
└── main.dart

test/
├── unit/
├── widget/
└── integration/
```

## Build & Test Commands
- Build APK: `flutter build apk --debug`
- Build iOS: `flutter build ios --debug --no-codesign`
- Test: `flutter test --coverage`
- Lint: `dart analyze`
- Format: `dart format .`
- Code gen: `dart run build_runner build --delete-conflicting-outputs`
