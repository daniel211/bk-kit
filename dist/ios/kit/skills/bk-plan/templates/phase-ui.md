# Phase Template: UI Screen

Use for: screens, views, UI components that have visual output.
Extends coding template with: Figma Input, Strings table.

```markdown
---
phase: {N}
title: {Screen Name}
depends: [{dependency phase numbers}]
status: pending
platforms: [{platforms}]
reqs: [{REQ-IDs}]
owns: ["{glob patterns for files this phase creates/modifies}"]
---

# Phase {N}: {Screen Name}

{One-line description.}

## Foundation References
<!-- Auto-filled from mk/docs/foundation/ during plan synthesis -->
- Architecture: {{foundation.architecture}}
- State Management: {{foundation.stateManagement}}
- Naming Convention: {{foundation.naming}}
- Test Pattern: {{foundation.testPattern}}
- Related Components: {{foundation.relatedComponents}}

## Existing Code

{Code snippets of navigation/router and any existing UI patterns.}

\```swift
// {AppRouter.swift}:{line} — current navigation setup
{existing router code}
\```

## Input (from Figma)

Screen: `inputs/design.json` → screens["{screen_name}"]

{List key components from DesignOutput:}
- {component type}: {name} ({details: color, font, size})
- {component type}: {name}
- Interaction: {type} → {target screen}
- Tokens: {colors.primary #hex}, {typography.body}

## Strings

| Key | EN | VI | Where |
|-----|----|----|-------|
| `{feature}.{screen}.title` | {text} | {text} | Title label |
| `{feature}.{screen}.{element}` | {text} | {text} | {location} |
| `{feature}.{screen}.error.{type}` | {text} | {text} | Error message |

_Include all user-visible text. Dev agent generates localization files from this table._

## Expected Code

### iOS

\```swift
// {Screens/Feature/ScreenView.swift} — NEW
struct {Screen}View: View {
    @State private var viewModel: {Screen}ViewModel

    var body: some View {
        VStack(spacing: 16) {
            Text(String(localized: "{feature}.{screen}.title"))
                .font(.heading)

            // {component from Figma}
            TextField(String(localized: "{feature}.{screen}.email"), text: $viewModel.email)

            Button(String(localized: "{feature}.{screen}.button")) {
                Task { await viewModel.submit() }
            }
            .buttonStyle(.primary) // {colors.primary}
        }
    }
}
\```

\```swift
// {Screens/Feature/ScreenViewModel.swift} — NEW
@Observable
class {Screen}ViewModel {
    var email = ""
    var error: String?
    var isLoading = false

    // {describe key methods and their logic}
}
\```

### Android

\```kotlin
// {ui/feature/ScreenName.kt} — NEW
@Composable
fun {Screen}Screen(viewModel: {Screen}ViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsState()

    Column(modifier = Modifier.padding(16.dp)) {
        Text(stringResource(R.string.{feature}_{screen}_title),
            style = MaterialTheme.typography.headlineMedium)

        OutlinedTextField(value = state.email,
            onValueChange = viewModel::onEmailChange,
            label = { Text(stringResource(R.string.{feature}_{screen}_email)) })

        Button(onClick = viewModel::submit,
            colors = ButtonDefaults.buttonColors(containerColor = Color({hex}))) {
            Text(stringResource(R.string.{feature}_{screen}_button))
        }
    }
}
\```

## Tasks

- [ ] Create {Screen} layout from Figma component tree
- [ ] Create {Screen}ViewModel with validation + business logic
- [ ] Wire navigation: {success → target}, {links → targets}
- [ ] Handle error states (show inline error messages)
- [ ] Add route to AppRouter/Navigator

## Done When

- Screen visually matches Figma {screen_name}
- {Primary flow}: input → validate → API → navigate
- Error states shown with localized messages
- Navigation to/from screen works
- All strings use localization keys (no hardcoded text)

## Refs

- {REQ-ID}: {brief text}
- Screen: {screen_name} from Figma
- Endpoint: {method} {path} (if screen calls API)
```

## Guidelines

- Strings table MUST include all user-visible text including error messages
- Expected Code MUST use `String(localized:)` (iOS) or `stringResource()` (Android)
- Never hardcode UI text in Expected Code
- Figma Input section maps directly from `inputs/design.json`
- For Flutter: use `AppLocalizations.of(context)!.{key}` pattern
