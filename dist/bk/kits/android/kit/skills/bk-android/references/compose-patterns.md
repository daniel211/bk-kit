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
