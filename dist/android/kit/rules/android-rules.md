# Android Platform Rules

## Language & Conventions
- Kotlin (latest stable), no Java for new code
- PascalCase: classes, interfaces, objects
- camelCase: functions, properties, local variables
- SCREAMING_SNAKE_CASE: constants
- File named after primary class: UserProfileScreen.kt, LoginViewModel.kt

## UI Framework
- Jetpack Compose preferred for new screens
- XML layouts for legacy modules only
- Material 3 Design components
- Preview annotations for every Composable

## Async
- Kotlin Coroutines + Flow preferred
- viewModelScope for ViewModel coroutines
- StateFlow / SharedFlow for reactive state
- No LiveData for new code

## Dependencies
- Gradle Version Catalog (libs.versions.toml)
- Minimize dependencies
- Prefer Jetpack libraries (Room, Navigation, Hilt/Koin)

## Project Structure
```
app/
├── src/main/
│   ├── java/com/app/
│   │   ├── di/               # DI modules
│   │   ├── features/
│   │   │   ├── auth/
│   │   │   │   ├── ui/
│   │   │   │   ├── viewmodel/
│   │   │   │   └── model/
│   │   │   └── home/
│   │   ├── core/
│   │   │   ├── network/
│   │   │   ├── database/
│   │   │   └── extensions/
│   │   └── App.kt
│   └── res/
├── src/test/                  # Unit tests
└── src/androidTest/           # Instrumented tests
```

## Build & Test Commands
- Build: `./gradlew assembleDebug`
- Test: `./gradlew test`
- Lint: `./gradlew ktlintCheck detekt`
- Format: `./gradlew ktlintFormat`
