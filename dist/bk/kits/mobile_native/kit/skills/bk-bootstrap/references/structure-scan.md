# Structure Scan

Discover project layout, file counts, LOC, and entry points.

## Platform Detection Signals

| Signal | Platform |
|--------|----------|
| `pubspec.yaml` | flutter |
| `.xcworkspace` or `.xcodeproj` (no `android/`) | ios |
| `build.gradle` or `build.gradle.kts` (no `ios/`) | android |
| Both `ios/` + `android/` (no `pubspec.yaml`) | monorepo |

IF ambiguous → **use `AskUserQuestion` tool** with detected signals as options before proceeding.

## File Structure Scan

```
1. Glob("**/*.{swift,kt,dart,java}") → count source files
2. Glob("**/*test*/**/*.{swift,kt,dart}") → count test files
3. For each top-level source directory:
   - Count files
   - Sum LOC: wc -l via Bash
   - Detect purpose from directory name
4. Find entry points:
   - Flutter: lib/main.dart
   - iOS: AppDelegate.swift or App.swift (@main)
   - Android: Application.kt or MainActivity.kt
```

## Output Shape (for synthesis)

```
structure:
  platform: {detected}
  signals: [{file paths}]
  directories:
    - path: lib/features/
      files: 42
      loc: 3200
      purpose: Feature modules
  entryPoints: [lib/main.dart]
  totalFiles: 90
  totalLoc: 6750
```
