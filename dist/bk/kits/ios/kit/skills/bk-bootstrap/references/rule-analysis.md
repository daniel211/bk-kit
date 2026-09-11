# Rule Analysis

Detect lint configs, code conventions, and test patterns from project files.

## Lint Config Detection

| Platform | Config Files to Check |
|----------|-----------------------|
| Flutter | `analysis_options.yaml`, `.dart-fix.yaml` |
| iOS | `.swiftlint.yml`, `.swiftformat` |
| Android | `detekt.yml`, `.editorconfig`, `ktlint` in gradle |

### Extract Key Rules

Read detected config file and extract:
- Disabled rules (team decided to ignore)
- Custom rules (team-specific standards)
- Severity overrides (error vs warning)
- Excluded paths

Output example:
```
lintRules:
  source: analysis_options.yaml
  keyRules:
    - "prefer_const_constructors: warning"
    - "avoid_print: error"
    - "public_member_api_docs: disabled"
  excludedPaths: ["**/*.g.dart", "**/*.freezed.dart"]
```

## Code Convention Detection

Scan source files to observe actual patterns (not assumptions):

### File Naming
```
Glob("lib/**/*.dart") → extract file names → detect pattern
  all snake_case → "snake_case"
  mixed → "mixed (inconsistent)" + list exceptions
```

### Class Naming
```
Grep("^class ", glob: "*.{swift,kt,dart}") → extract class names
  PascalCase → standard
  suffix patterns: *ViewModel, *Repository, *UseCase, *Screen, *Widget
```

### Folder Structure
```
ls source directories → detect repeating structure
  e.g., features/auth/{data,domain,presentation}/
  → "Feature-first with Clean Architecture layers"
```

### Import Organization
```
Read 3-5 representative files → observe import grouping
  - Dart/package imports first, then relative?
  - Sorted alphabetically?
  - Grouped by type (UI, data, domain)?
```

## Test Convention Detection

### Test File Naming
```
Grep test directories for naming pattern:
  {class}_test.dart → mirrors source
  test_{class}.dart → prefix style
  {class}Tests.swift → suffix style
```

### Test Structure
```
Read 2-3 test files → detect pattern:
  - group/test (Dart)
  - describe/it (Jest-like)
  - func test* (XCTest)
  - @Test (JUnit)
```

### Mock Approach
```
Grep test files for mock patterns:
  "import.*mocktail" → mocktail
  "import.*mockito" → mockito
  "@MockK" → MockK
  "protocol.*Mock" → protocol-based mocks
```

## Output Shape (for synthesis)

```
rules:
  lintConfig: { file: "analysis_options.yaml", keyRules: [...], excludes: [...] }
  conventions:
    fileNaming: { pattern: "snake_case", exceptions: [] }
    classNaming: { pattern: "PascalCase", suffixes: ["ViewModel", "Repository"] }
    folderStructure: { pattern: "features/{name}/{data,domain,presentation}/" }
    importStyle: { pattern: "package first, then relative, sorted" }
  testConventions:
    fileNaming: "{class}_test.dart"
    structure: "group/test"
    mockApproach: "mocktail"
```
