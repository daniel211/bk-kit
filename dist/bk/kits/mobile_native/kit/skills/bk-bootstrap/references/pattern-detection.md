# Pattern Detection

Detect architecture, state management, DI, navigation, networking from code.

## Strategy: Layered Detection

Follow `rules/coding-intelligence-priority.md` for tool selection.

**Layer 1 — Grep (always):**
Grep import statements and class declarations to tally framework usage.

**Layer 2 — Semantic verification (if available):**
Use Serena (P1) or LSP (P2) for semantic verification.
See `references/serena-integration.md` and `references/lsp-analysis.md`.

## Detection Table

### Architecture Pattern

| Grep Pattern | Detected As | Platform |
|-------------|-------------|----------|
| `class.*ViewModel` | MVVM | all |
| `class.*UseCase` or `class.*Interactor` | Clean Architecture | all |
| `class.*Repository` + `class.*DataSource` | Repository pattern | all |
| `class.*Coordinator` or `class.*Router` | Coordinator/Router | iOS |
| `features/{name}/{data,domain,presentation}` | Feature-first | all |
| `class.*Bloc` or `class.*Cubit` | BLoC pattern | Flutter |

### State Management

| Grep Pattern | Detected As |
|-------------|-------------|
| `import.*riverpod` | Riverpod |
| `import.*flutter_bloc` or `class.*Bloc` | BLoC |
| `import.*provider` (no riverpod) | Provider |
| `import.*GetX` | GetX |
| `@Observable` or `@State` | SwiftUI native |
| `StateFlow` or `MutableStateFlow` | Kotlin StateFlow |

### DI

| Grep Pattern | Detected As |
|-------------|-------------|
| `import.*get_it` or `GetIt.instance` | get_it |
| `@injectable` or `import.*injectable` | injectable (get_it) |
| `import.*riverpod` (providers as DI) | Riverpod |
| `@HiltAndroidApp` or `@Inject` | Hilt |
| `import.*koin` | Koin |
| `import.*Swinject` | Swinject |
| No DI lib detected | Manual / Service Locator |

### Navigation

| Grep Pattern | Detected As |
|-------------|-------------|
| `import.*go_router` | GoRouter |
| `import.*auto_route` | AutoRoute |
| `NavigationStack` or `NavigationPath` | SwiftUI Navigation |
| `class.*Coordinator` | Coordinator pattern |
| `NavHost` or `NavController` | Jetpack Navigation |

### Networking

| Grep Pattern | Detected As |
|-------------|-------------|
| `import.*dio` | Dio |
| `import.*retrofit` | Retrofit |
| `import.*http` (dart) | http package |
| `import.*Alamofire` | Alamofire |
| `import.*Moya` | Moya |
| `URLSession` | URLSession (native) |
| `import.*okhttp` | OkHttp |
| `import.*ktor` | Ktor |

### Serialization

| Grep Pattern | Detected As |
|-------------|-------------|
| `import.*freezed` or `@freezed` | freezed |
| `import.*json_serializable` | json_serializable |
| `Codable` or `Decodable` | Swift Codable |
| `@Serializable` (kotlin) | kotlinx.serialization |
| `import.*moshi` | Moshi |
| `import.*gson` | Gson |

### Error Handling

| Grep Pattern | Detected As |
|-------------|-------------|
| `import.*dartz` or `Either<` | Either (dartz/fpdart) |
| `Result<` (swift) | Swift Result |
| `sealed class.*Error` or `sealed class.*Failure` | Sealed class errors |
| `runCatching` | Kotlin runCatching |

## Layer 2 — Serena Semantic Verification (if available)

After Grep detection, use Serena to verify and enrich findings:

```
1. Architecture verification:
   serena get_symbols_overview(relative_path: "Sources/Features/", depth: 1)
   → Verify class hierarchy: LoginViewModel : BaseViewModel
   → Confirm MVVM/Clean/BLoC pattern with actual inheritance

2. Interface→Implementation mapping:
   serena find_referencing_symbols(symbol_name: "UserRepository")
   → Interface UserRepository ← UserRepositoryImpl (data layer)
   → Confirm Repository pattern is real, not just naming convention

3. DI structure (if DI detected by Grep):
   serena get_symbols_overview(relative_path: "{di-directory}/", depth: 1)
   → List Modules, Provides, Binds → DI graph clarity
```

Fallback: If Serena unavailable → Grep Layer 1 results are sufficient.
See `references/serena-integration.md` for full tool reference and decision table.

## Counting Evidence

For each detected pattern, count files using it:
```
Grep("import.*riverpod", glob: "*.dart", output_mode: "count")
→ "Riverpod detected (23 files)"
```

Always include file count as evidence in output.

## Output Shape (for synthesis)

```
patterns:
  architecture: { value: "MVVM + Clean", evidence: "features/{data,domain,presentation}/ in 8 features" }
  stateManagement: { value: "Riverpod", evidence: "flutter_riverpod in pubspec, 23 import files" }
  di: { value: "Riverpod", evidence: "no get_it, providers used as DI" }
  navigation: { value: "GoRouter", evidence: "go_router ^14.0, lib/core/router/" }
  networking: { value: "Dio + Retrofit", evidence: "dio ^5.4 + retrofit ^4.1" }
  serialization: { value: "freezed", evidence: "freezed_annotation, 15 .freezed.dart files" }
  errorHandling: { value: "Either (dartz)", evidence: "dartz ^0.10, 12 files use Either" }
```
