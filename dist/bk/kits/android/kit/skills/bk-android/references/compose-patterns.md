# Jetpack Compose Quick Reference

## State Management Cheat Sheet
| API | Use Case |
|---|---|
| `remember { mutableStateOf(x) }` | Local UI state |
| `rememberSaveable` | Survives config change |
| `StateFlow` + `collectAsStateWithLifecycle()` | ViewModel state |
| `derivedStateOf` | Computed from other state |

## State Hoisting Pattern
```kotlin
// Stateful (screen-level)
@Composable
fun ProfileScreen(vm: ProfileViewModel = hiltViewModel()) {
    val state by vm.uiState.collectAsStateWithLifecycle()
    ProfileContent(state = state, onEdit = vm::edit)
}

// Stateless (reusable, testable, previewable)
@Composable
fun ProfileContent(state: ProfileUiState, onEdit: () -> Unit) {
    // Pure UI rendering
}
```

## ViewModel + StateFlow
```kotlin
@HiltViewModel
class ProfileViewModel @Inject constructor(
    private val repo: UserRepository
) : ViewModel() {
    private val _uiState = MutableStateFlow<UiState>(UiState.Loading)
    val uiState = _uiState.asStateFlow()

    init { load() }

    private fun load() = viewModelScope.launch {
        _uiState.value = try {
            UiState.Success(repo.fetch())
        } catch (e: Exception) {
            UiState.Error(e.message.orEmpty())
        }
    }
}
```

## Navigation (NavHost)
```kotlin
NavHost(navController, startDestination = "home") {
    composable("home") { HomeScreen(onNavigate = { navController.navigate("detail/$it") }) }
    composable("detail/{id}", arguments = listOf(navArgument("id") { type = NavType.StringType })) {
        DetailScreen()
    }
}
```

## Composition Patterns
```kotlin
// Slot-based API
@Composable
fun Card(title: String, content: @Composable () -> Unit) {
    Column { Text(title); content() }
}

// Modifier chaining
Modifier
    .fillMaxWidth()
    .padding(16.dp)
    .clip(RoundedCornerShape(8.dp))
    .background(MaterialTheme.colorScheme.surface)
```

## LazyList Performance
```kotlin
LazyColumn {
    items(items, key = { it.id }) { item ->
        ItemRow(item)
    }
}
// Always provide key for stable recomposition
```

## Preview
```kotlin
@Preview(showBackground = true, widthDp = 360)
@Composable
private fun ProfilePreview() {
    AppTheme {
        ProfileContent(
            state = UiState.Success(previewUser),
            onEdit = {}
        )
    }
}
```

## Side Effects
```kotlin
LaunchedEffect(userId) { vm.load(userId) }      // Run suspend on composition
DisposableEffect(key) { onDispose { cleanup() } } // Lifecycle-aware cleanup
SideEffect { analytics.trackScreen("profile") }   // After every recomposition
```

## Jetpack Compose Patterns — full examples

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
