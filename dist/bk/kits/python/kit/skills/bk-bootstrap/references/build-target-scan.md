# Build Target Scan

Detect build/test/lint commands, CI configs, SDK versions.

## Command Detection

### From CI Config

Check these files in order:
```
.github/workflows/*.yml
.gitlab-ci.yml
Fastfile (fastlane)
Makefile
justfile
```

Extract commands from CI steps: build, test, lint, format, deploy.

### From Project Config

| Platform | Build | Test | Lint | Format |
|----------|-------|------|------|--------|
| Flutter | `flutter build apk --debug` | `flutter test` | `dart analyze` | `dart format .` |
| iOS | `xcodebuild -scheme {X}` | `xcodebuild test` | `swiftlint` | `swiftformat .` |
| Android | `./gradlew assembleDebug` | `./gradlew test` | `./gradlew detekt` | `./gradlew ktlintFormat` |

Override defaults with actual commands found in CI config.

### Codegen Detection

| Platform | Signal | Command |
|----------|--------|---------|
| Flutter | `build_runner` in pubspec | `dart run build_runner build` |
| iOS | `.sourcery.yml` | `sourcery` |
| Android | `kapt` or `ksp` in gradle | part of gradle build |

## SDK / Platform Targets

### Flutter
```
Read pubspec.yaml:
  environment.sdk → Dart SDK constraint
Read android/app/build.gradle:
  minSdkVersion → Android min SDK
  targetSdkVersion → Android target SDK
Read ios/Podfile:
  platform :ios, '{version}' → iOS min version
```

### iOS
```
Read .xcodeproj/project.pbxproj or xcconfig:
  IPHONEOS_DEPLOYMENT_TARGET → min iOS version
  SWIFT_VERSION → Swift version
```

### Android
```
Read build.gradle or build.gradle.kts:
  minSdk → min Android SDK
  targetSdk → target SDK
  kotlinOptions.jvmTarget → JVM target
```

## Quality Gates (from CI)

Scan CI config for quality checks:
```
Grep CI files for:
  "coverage" → coverage threshold (extract percentage)
  "lint" or "analyze" → lint step exists
  "test" → test step exists
  "--strict" or "warnings-as-errors" → strict mode
```

## Output Shape (for synthesis)

```
buildTargets:
  commands:
    build: { cmd: "flutter build apk --debug", source: ".github/workflows/ci.yml" }
    test: { cmd: "flutter test --coverage", source: ".github/workflows/ci.yml" }
    lint: { cmd: "dart analyze", source: "analysis_options.yaml" }
    format: { cmd: "dart format .", source: "default" }
    codegen: { cmd: "dart run build_runner build", source: "pubspec.yaml" }
  ci:
    platform: "GitHub Actions"
    configFile: ".github/workflows/ci.yml"
    triggers: ["push", "pull_request"]
  qualityGates:
    coverage: { threshold: "80%", source: "ci.yml:42" }
    lint: { strict: true, source: "analysis_options.yaml" }
  sdk:
    minSdk: "Flutter 3.24 / Dart 3.5"
    targetSdk: "Android 34 / iOS 17.0"
```
