---
name: bk-android
description: "Kotlin/Compose patterns + JUnit5/MockK. Platform knowledge for bk-android-developer."
user-invocable: false
---

# bk-android Platform Knowledge

Code patterns and examples for Android development with Kotlin/Jetpack Compose and JUnit5/MockK.

---

## Jetpack Compose Patterns

### Composable with State Hoisting
```kotlin
@Composable
fun UserProfileScreen(
    viewModel: UserProfileViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()

    UserProfileContent(
        state = uiState,
        onRefresh = viewModel::refresh,
        onEditClick = viewModel::onEditClick
    )
}

@Composable
private fun UserProfileContent(
    state: UserProfileUiState,
    onRefresh: () -> Unit,
    onEditClick: () -> Unit
) {
    when (state) {
        is UiState.Loading -> LoadingIndicator()
        is UiState.Success -> ProfileBody(state.user, onEditClick)
        is UiState.Error -> ErrorMessage(state.message, onRetry = onRefresh)
    }
}
```

### ViewModel with StateFlow
```kotlin
@HiltViewModel
class UserProfileViewModel @Inject constructor(
    private val repository: UserRepository,
    savedStateHandle: SavedStateHandle
) : ViewModel() {

    private val userId: String = savedStateHandle["userId"]!!

    private val _uiState = MutableStateFlow<UiState<User>>(UiState.Loading)
    val uiState: StateFlow<UiState<User>> = _uiState.asStateFlow()

    init { refresh() }

    fun refresh() {
        viewModelScope.launch {
            _uiState.value = UiState.Loading
            try {
                val user = repository.fetchUser(userId)
                _uiState.value = UiState.Success(user)
            } catch (e: Exception) {
                _uiState.value = UiState.Error(e.message ?: "Unknown error")
            }
        }
    }
}

sealed interface UiState<out T> {
    data object Loading : UiState<Nothing>
    data class Success<T>(val data: T) : UiState<T>
    data class Error(val message: String) : UiState<Nothing>
}
```

### Preview
```kotlin
@Preview(showBackground = true)
@Composable
private fun UserProfilePreview() {
    AppTheme {
        UserProfileContent(
            state = UiState.Success(User(id = "1", name = "Preview User")),
            onRefresh = {},
            onEditClick = {}
        )
    }
}
```

### Navigation (Compose Navigation)
```kotlin
@Composable
fun AppNavHost(navController: NavHostController = rememberNavController()) {
    NavHost(navController, startDestination = "home") {
        composable("home") { HomeScreen(onUserClick = { navController.navigate("profile/$it") }) }
        composable("profile/{userId}") { UserProfileScreen() }
        composable("settings") { SettingsScreen() }
    }
}
```

---

## JUnit5 + MockK Patterns

### Basic Test Setup
```kotlin
import io.mockk.*
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.*

class UserRepositoryTest {
    private lateinit var api: MockAPIClient
    private lateinit var sut: UserRepository

    @BeforeEach
    fun setUp() {
        api = mockk()
        sut = UserRepository(api)
    }

    @AfterEach
    fun tearDown() {
        unmockkAll()
    }

    @Test
    @DisplayName("fetchUser returns user on success")
    fun fetchUser_success() = runTest {
        coEvery { api.getUser("1") } returns User(id = "1", name = "Test")

        val result = sut.fetchUser("1")

        assertEquals("Test", result.name)
        coVerify(exactly = 1) { api.getUser("1") }
    }

    @Test
    @DisplayName("fetchUser throws on network error")
    fun fetchUser_networkError() = runTest {
        coEvery { api.getUser(any()) } throws NetworkException("timeout")

        assertThrows<NetworkException> {
            sut.fetchUser("1")
        }
    }
}
```

### Flow Testing with Turbine
```kotlin
import app.cash.turbine.test

@Test
fun viewModel_emitsStates() = runTest {
    val vm = UserViewModel(FakeUserRepository())

    vm.uiState.test {
        assertEquals(UiState.Loading, awaitItem())
        assertEquals(UiState.Success(user), awaitItem())
        cancelAndIgnoreRemainingEvents()
    }
}
```

### Coroutine Testing
```kotlin
import kotlinx.coroutines.test.*

class UserViewModelTest {
    private val testDispatcher = StandardTestDispatcher()

    @BeforeEach
    fun setUp() {
        Dispatchers.setMain(testDispatcher)
    }

    @AfterEach
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun loadUser_updatesState() = runTest {
        val vm = UserViewModel(FakeUserRepository())

        vm.loadUser("1")
        advanceUntilIdle()

        assertEquals("Test", vm.uiState.value.userName)
    }
}
```

### Fake Implementation
```kotlin
class FakeUserRepository : UserRepository {
    val users = mutableMapOf<String, User>()

    override suspend fun fetchUser(id: String): User {
        return users[id] ?: throw NotFoundException("User $id not found")
    }

    override suspend fun saveUser(user: User) {
        users[user.id] = user
    }
}
```
