# Architecture Code Patterns (bk-architecture)

Reference implementations for MVVM, Repository and DI on each platform.

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
