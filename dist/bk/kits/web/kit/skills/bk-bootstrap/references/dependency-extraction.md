# Dependency Extraction

Read dependency files to extract packages, versions, and categories.

## Dependency File Detection

| Platform | File | Format |
|----------|------|--------|
| Flutter | `pubspec.yaml` | YAML |
| iOS | `Package.swift` | Swift |
| iOS | `Podfile` + `Podfile.lock` | Ruby |
| Android | `build.gradle.kts` or `build.gradle` | Kotlin/Groovy |
| Android | `libs.versions.toml` | TOML (version catalog) |

Read the detected file. Parse dependencies section.

## Category Classification

Classify each dependency by purpose:

| Category | Keywords / Known Packages |
|----------|--------------------------|
| State | riverpod, bloc, provider, getx, combine, stateflow |
| Network | dio, retrofit, http, alamofire, moya, okhttp, ktor |
| DI | get_it, injectable, hilt, koin, swinject |
| Navigation | go_router, auto_route, coordinator |
| Storage | hive, drift, sqflite, core_data, room, realm |
| Security | flutter_secure_storage, keychain, keystore |
| UI | cached_network_image, shimmer, lottie, material |
| Codegen | freezed, json_serializable, build_runner |
| Testing | flutter_test, mocktail, mockito, mockk, xctest |
| Lint | lint, very_good_analysis, swiftlint, detekt |
| Util | intl, equatable, dartz, fpdart, rxswift, rxkotlin |

## Usage Count

For each core dependency, count how many source files import it:
```
Grep("import.*{package}", glob: "*.{dart,swift,kt}", output_mode: "count")
```

This provides evidence of actual usage (not just declared).

## Dev vs Production

Separate:
- **Core dependencies**: `dependencies:` (pubspec) / `implementation` (gradle)
- **Dev dependencies**: `dev_dependencies:` (pubspec) / `testImplementation` (gradle)

## Output Shape (for synthesis)

```
dependencies:
  source: pubspec.yaml
  core:
    - { name: "flutter_riverpod", version: "^2.5.1", category: "State", usedIn: 23 }
    - { name: "dio", version: "^5.4.0", category: "Network", usedIn: 8 }
  dev:
    - { name: "flutter_test", version: "sdk", category: "Testing" }
    - { name: "mocktail", version: "^1.0.3", category: "Testing" }
  risks:
    - "package X is deprecated since v2.0"
    - "package Y has known vulnerability CVE-XXXX"
```
