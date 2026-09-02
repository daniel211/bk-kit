---
name: bk-architecture
description: "SOLID principles, Clean Architecture layers, MVVM pattern, Repository pattern, and DI patterns for iOS (Swinject/manual), Android (Hilt/Koin), and Flutter (get_it/Riverpod)."
user-invocable: false
allowed-tools: "Read Glob Grep"
---

# Architecture Skill

> SOLID, Clean Architecture, MVVM, Repository Pattern, DI for mobile platforms

---

## Core Principles: SOLID

| Principle | iOS | Android | Flutter |
|-----------|-----|---------|---------|
| **S**ingle Responsibility | 1 class = 1 job | 1 class = 1 job | 1 class = 1 job |
| **O**pen/Closed | Protocol extensions | Interface + impl | Abstract class + impl |
| **L**iskov Substitution | Protocol conformance | Interface contracts | Abstract contracts |
| **I**nterface Segregation | Small protocols | Small interfaces | Small abstract classes |
| **D**ependency Inversion | Protocol injection | Hilt/Koin DI | get_it / Riverpod |

---

## Clean Architecture Layers

```
┌─────────────────────────────────────┐
│         Presentation Layer          │
│    (Views, ViewModels, UI State)    │
├─────────────────────────────────────┤
│           Domain Layer              │
│  (UseCases, Entities, Repositories) │
│         NO DEPENDENCIES             │
├─────────────────────────────────────┤
│            Data Layer               │
│ (RepositoryImpl, DataSources, API)  │
└─────────────────────────────────────┘
```

### Dependency Flow (MANDATORY)

```
Presentation → Domain ← Data
              (abstractions)
```

Domain MUST NOT depend on Presentation or Data.

---

## MVVM Pattern

### iOS — MVVM + Coordinator

```swift
// ViewModel: @Observable, injected use case
@Observable
final class LoginViewModel {
    private let authUseCase: AuthenticatingUseCase
    var state: LoginState = .idle

    init(authUseCase: AuthenticatingUseCase) {
        self.authUseCase = authUseCase
    }

    @MainActor
    func login(email: String, password: String) async {
        state = .loading
        do {
            let user = try await authUseCase.execute(email: email, password: password)
            state = .success(user)
        } catch {
            state = .error(error.localizedDescription)
        }
    }
}
```

### Android — MVVM + MVI + StateFlow

```kotlin
@HiltViewModel
class LoginViewModel @Inject constructor(
    private val loginUseCase: LoginUseCase
) : ViewModel() {
    private val _state = MutableStateFlow(LoginState())
    val state: StateFlow<LoginState> = _state.asStateFlow()

    fun processIntent(intent: LoginIntent) {
        when (intent) {
            is LoginIntent.Login -> login(intent.email, intent.password)
        }
    }
}
```

---

## Repository Pattern

### iOS

```swift
protocol AuthRepository {
    func login(email: String, password: String) async throws -> User
}

final class AuthRepositoryImpl: AuthRepository {
    private let api: AuthAPI
    private let localStore: AuthLocalStore

    func login(email: String, password: String) async throws -> User {
        let response = try await api.login(email: email, password: password)
        try await localStore.saveToken(response.token)
        return response.user
    }
}
```

### Android

```kotlin
interface AuthRepository {
    suspend fun login(email: String, password: String): Result<User>
}

class AuthRepositoryImpl @Inject constructor(
    private val api: AuthApi,
    private val localDataSource: AuthLocalDataSource
) : AuthRepository {
    override suspend fun login(email: String, password: String): Result<User> =
        runCatching {
            val response = api.login(LoginRequest(email, password))
            localDataSource.saveToken(response.token)
            response.user.toDomain()
        }
}
```

---

## Dependency Injection

### iOS (Manual / Swinject)

```swift
protocol DependencyContainer {
    var authService: Authenticating { get }
    var userRepository: UserRepositoryProtocol { get }
}

final class AppContainer: DependencyContainer {
    lazy var authService: Authenticating = AuthService()
    lazy var userRepository: UserRepositoryProtocol = UserRepository()
}
```

### Android (Hilt)

```kotlin
@Module
@InstallIn(SingletonComponent::class)
object AuthModule {
    @Provides @Singleton
    fun provideAuthRepository(
        api: AuthApi,
        localDataSource: AuthLocalDataSource
    ): AuthRepository = AuthRepositoryImpl(api, localDataSource)
}
```

### Flutter (get_it)

```dart
final getIt = GetIt.instance;

void setupDI() {
    getIt.registerSingleton<AuthRepository>(AuthRepositoryImpl());
    getIt.registerFactory<LoginViewModel>(
        () => LoginViewModel(getIt<AuthRepository>())
    );
}
```

---

## Modular Architecture Rules

| Rule | Description |
|------|-------------|
| MOD-001 | Feature modules MUST NOT depend on other features |
| MOD-002 | Core modules have minimal dependencies |
| MOD-003 | Domain modules MUST NOT depend on data/presentation |
| MOD-004 | Keep module interface minimal |

---

## State Management: Unidirectional Data Flow (UDF)

```
View → (Intent/Action) → ViewModel → (State) → View
```

- iOS: `@Observable` ViewModel + SwiftUI state bindings
- Android: `StateFlow` / `SharedFlow` in ViewModel
- Flutter: `Riverpod` StateNotifier or `Bloc` events/states
