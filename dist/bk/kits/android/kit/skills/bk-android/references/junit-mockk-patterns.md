# JUnit 5 + MockK Quick Reference

## Test Naming Convention
```kotlin
@DisplayName("fetchUser returns user on success")
fun fetchUser_success() = runTest { ... }
```

## Common Assertions
```kotlin
assertEquals(expected, actual)
assertTrue(condition)
assertNull(value)
assertThrows<NetworkException> { sut.fetch() }
assertDoesNotThrow { sut.validate() }
```

## MockK Basics
```kotlin
val repo = mockk<UserRepository>()

// Suspend functions
coEvery { repo.fetchUser("1") } returns user
coEvery { repo.fetchUser(any()) } throws NetworkException("fail")
coVerify(exactly = 1) { repo.fetchUser("1") }

// Regular functions
every { repo.getCached() } returns user
verify { repo.getCached() }

// Relaxed mock (returns defaults)
val relaxed = mockk<Logger>(relaxed = true)
```

## Coroutine Testing
```kotlin
class MyViewModelTest {
    private val testDispatcher = StandardTestDispatcher()

    @BeforeEach
    fun setUp() { Dispatchers.setMain(testDispatcher) }

    @AfterEach
    fun tearDown() { Dispatchers.resetMain() }

    @Test
    fun loadData_updatesState() = runTest {
        val vm = MyViewModel(FakeRepository())
        vm.load()
        advanceUntilIdle()
        assertEquals(UiState.Success(data), vm.uiState.value)
    }
}
```

## Flow Testing with Turbine
```kotlin
@Test
fun stateFlow_emitsCorrectSequence() = runTest {
    val vm = MyViewModel(FakeRepository())
    vm.uiState.test {
        assertEquals(UiState.Loading, awaitItem())
        assertEquals(UiState.Success(data), awaitItem())
        cancelAndIgnoreRemainingEvents()
    }
}
```

## ViewModel Testing Pattern
```kotlin
@ExtendWith(MainDispatcherExtension::class)
class UserViewModelTest {
    private val repo = mockk<UserRepository>()
    private lateinit var vm: UserViewModel

    @BeforeEach
    fun setUp() {
        coEvery { repo.fetchUser(any()) } returns testUser
        vm = UserViewModel(repo)
    }

    @Test
    fun refresh_reloadsData() = runTest {
        vm.refresh()
        advanceUntilIdle()
        assertTrue(vm.uiState.value is UiState.Success)
    }
}
```

## Cleanup
```kotlin
@AfterEach
fun tearDown() {
    unmockkAll()  // Clear all mocks
    clearAllMocks()  // Alternative: clear without unregistering
}
```

## JUnit5 + MockK Patterns — full examples

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
