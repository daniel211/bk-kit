# Sub-Task Template: UI Screen

Use for: screens, views, UI components that have visual output.
Extends coding template with: Figma specs, Strings localization, UI-specific review checks.

```markdown
---
sub-task: {NN}
title: "{Screen Name}"
depends: [{dependency sub-task numbers}]
parallel-with: [{sub-tasks that can run concurrently}]
status: pending
effort: {Xh}
platform: {ios|android|flutter}
owns: ["{glob patterns for files this sub-task creates/modifies}"]
reqs: [{REQ-IDs this sub-task fulfills}]
figma-frame: "{Figma frame name or URL}"
---

# Sub-Task {NN}: {Screen Name}

{One-line description.}

## Scope
- Create: {list new files}
- Modify: {list modified files with reason}
- LOC estimate: ~{N} lines

## Input References
- PRD: {section reference}
- API: {endpoint reference from inputs/api.json}
- Depends on: sub-task-{XX} output ({what it provides — e.g., ViewModel, data models})

## Foundation References
<!-- Auto-filled from bk/docs/foundation/ during plan synthesis -->
- Architecture: {{foundation.architecture}}
- State Management: {{foundation.stateManagement}}
- Naming Convention: {{foundation.naming}}
- Test Pattern: {{foundation.testPattern}}
- Related Components: {{foundation.relatedComponents}}

## Design Specs (from Figma MCP)
<!-- Auto-populated from inputs/design.json during plan synthesis -->
- Frame: {frame_name}
- Layout: {layout_mode}, spacing {spacing}pt
- Components:
  - {component}: {type}, {style details}
  - {component}: {type}, {style details}
- Tokens referenced:
  - colors.primary: {hex}
  - typography.heading: {font, size, weight}
  - spacing.md: {value}pt
- Interactions:
  - {trigger} → {target screen}

_If Figma MCP not available, populate manually or note gap._

## Existing Code

{Code snippets of navigation/router and any existing UI patterns.}

\```swift
// {AppRouter.swift}:{line} — current navigation setup
{existing router code}
\```

## Strings

| Key | EN | VI | Where |
|-----|----|----|-------|
| `{feature}.{screen}.title` | {text} | {text} | Title label |
| `{feature}.{screen}.{element}` | {text} | {text} | {location} |
| `{feature}.{screen}.error.{type}` | {text} | {text} | Error message |

_Include all user-visible text including error messages. Dev agent generates localization files from this table._

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

### Flutter

\```dart
// {lib/features/feature/presentation/screen_name.dart} — NEW
class {Screen}Screen extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Column(
        children: [
          Text(AppLocalizations.of(context)!.{feature}_{screen}_title),
          // {component from Figma}
        ],
      ),
    );
  }
}
\```

_Include only platforms targeted by this sub-task._

## Edge Cases & Risks
- [ ] {edge case 1 — e.g., empty state, no data}
- [ ] {edge case 2 — e.g., long text overflow, RTL layout}

## Success Criteria
- Screen visually matches Figma {frame_name}
- {Primary flow}: input → validate → API → navigate
- Error states shown with localized messages
- Navigation to/from screen works
- All strings use localization keys (no hardcoded text)

## Test Plan (for this sub-task)

| Test | Type | Priority | Verifies |
|------|------|----------|----------|
| test_{screen}_renders_correctly | snapshot | P0 | UI matches expected layout |
| test_{screen}_loading_state | ui_state | P0 | Loading indicator shows |
| test_{screen}_error_state | ui_state | P0 | Error message displays |
| test_{screen}_{interaction} | ui | P1 | {user interaction works} |

_Test sub-tasks aggregate these. Snapshot tests compare against Figma frame._

## Review Checklist
- [ ] UI matches Figma frame `{figma-frame}` (layout, spacing, colors, typography)?
- [ ] Accessibility: labels, contrast ratios, touch targets (44pt min)?
- [ ] Localization: all text from Strings table, no hardcoded strings?
- [ ] Follows architecture pattern from Foundation References?
- [ ] Naming conventions match code-guidelines.md?
- [ ] Error handling complete (all error states shown to user)?
- [ ] No hardcoded values (URLs, colors, magic numbers)?
- [ ] File ownership: no overlap with other sub-tasks' `owns`?
- [ ] {sub-task specific check}

## Refs
- {REQ-ID}: {brief text}
- Screen: {frame_name} from Figma
- Endpoint: {method} {path} (if screen calls API)
- Pattern: {existing file}:{line}
```

## Guidelines

- Target 30-80 LOC expected output per sub-task; split if >100 LOC
- Strings table MUST include all user-visible text including error messages
- Expected Code MUST use `String(localized:)` (iOS) or `stringResource()` (Android) or `AppLocalizations` (Flutter)
- Never hardcode UI text in Expected Code
- Design Specs section maps directly from `inputs/design.json` (auto-populated via Figma MCP)
- `figma-frame` in YAML = specific Figma frame for this screen
- UI-specific Review Checklist items (Figma match, accessibility, localization) are mandatory
- Snapshot/UI tests in Test Plan feed into test sub-tasks
- `depends` typically includes ViewModel sub-task; `parallel-with` often includes test sub-tasks
