# bk-repomix Mobile Presets

Platform-specific include/exclude patterns for repomix CLI.

## Preset: ios

Targets Swift source, Interface Builder files, plists, and Swift Package Manager.

```bash
repomix \
  --include "**/*.swift,**/*.xib,**/*.storyboard,**/*.plist,Package.swift,Package.resolved" \
  -i "Pods/,*.xcodeproj/xcuserdata/,*.xcworkspace/xcuserdata/,DerivedData/,build/,.build/" \
  --style xml \
  --remove-comments \
  -o repomix-ios.xml
```

| Field | Value |
|-------|-------|
| Include | `**/*.swift` `**/*.xib` `**/*.storyboard` `**/*.plist` `Package.swift` `Package.resolved` |
| Exclude | `Pods/` `*.xcodeproj/xcuserdata/` `*.xcworkspace/xcuserdata/` `DerivedData/` `build/` `.build/` |
| Why exclude Pods/ | CocoaPods dependencies — massive token cost, not your code |
| Why exclude DerivedData/ | Xcode build artifacts — always regenerated |

## Preset: android

Targets Kotlin/Java source, XML layouts/resources, and Gradle build files.

```bash
repomix \
  --include "**/*.kt,**/*.java,**/*.xml,build.gradle,build.gradle.kts,settings.gradle,settings.gradle.kts,gradle.properties,libs.versions.toml" \
  -i "build/,.gradle/,*.apk,*.aab,.idea/,*.iml" \
  --style xml \
  --remove-comments \
  -o repomix-android.xml
```

| Field | Value |
|-------|-------|
| Include | `**/*.kt` `**/*.java` `**/*.xml` `build.gradle*` `settings.gradle*` `gradle.properties` `libs.versions.toml` |
| Exclude | `build/` `.gradle/` `*.apk` `*.aab` `.idea/` `*.iml` |
| Why exclude build/ | Compiled output — large and not source |
| Why exclude .gradle/ | Gradle caches — auto-regenerated |

## Preset: flutter

Targets Dart source in lib/ and test/, plus pubspec config.

```bash
repomix \
  --include "lib/**/*.dart,test/**/*.dart,pubspec.yaml,pubspec.lock,analysis_options.yaml" \
  -i ".dart_tool/,build/,.flutter-plugins,.flutter-plugins-dependencies,*.g.dart,*.freezed.dart" \
  --style xml \
  --remove-comments \
  -o repomix-flutter.xml
```

| Field | Value |
|-------|-------|
| Include | `lib/**/*.dart` `test/**/*.dart` `pubspec.yaml` `pubspec.lock` `analysis_options.yaml` |
| Exclude | `.dart_tool/` `build/` `.flutter-plugins*` `*.g.dart` `*.freezed.dart` |
| Why exclude *.g.dart | Code-generated files — add noise, not source intent |
| Why exclude .dart_tool/ | Flutter tool cache — auto-regenerated |

## Preset: full

Combines all platform presets. Use when project is multi-platform or platform is unknown.

```bash
repomix \
  --include "**/*.swift,**/*.xib,**/*.storyboard,**/*.plist,Package.swift,**/*.kt,**/*.java,**/*.xml,build.gradle*,*.toml,lib/**/*.dart,test/**/*.dart,pubspec.yaml" \
  -i "Pods/,*.xcodeproj/xcuserdata/,DerivedData/,build/,.build/,.gradle/,*.apk,*.aab,.idea/,.dart_tool/,.flutter-plugins*,*.g.dart,*.freezed.dart" \
  --style xml \
  --remove-comments \
  -o repomix-full.xml
```

Warning: full preset can produce large outputs (50K–200K+ tokens). Check token count before feeding to LLM.

## Common Override Patterns

```bash
# Only authentication-related files
repomix --include "**/*Auth*,**/*Login*,**/*Session*" -o repomix-auth.xml

# Narrow to a feature module
repomix --include "src/features/checkout/**" -o repomix-checkout.xml

# Strip comments for maximum token reduction
repomix --include "lib/**/*.dart" --remove-comments -o repomix-flutter-lean.xml

# Copy to clipboard instead of file
repomix --include "**/*.swift" --remove-comments --copy
```

## Token Budget Guide

| Preset | Typical Token Range | Fits Claude 200K? |
|--------|--------------------|--------------------|
| ios (small app) | 10K–40K | Yes |
| ios (large app) | 40K–120K | Yes |
| android (small) | 15K–50K | Yes |
| android (large) | 50K–150K | Usually |
| flutter (small) | 10K–30K | Yes |
| flutter (large) | 30K–80K | Yes |
| full | 50K–300K+ | Check first |

Use `repomix --token-count-tree` to inspect token distribution before packing.
