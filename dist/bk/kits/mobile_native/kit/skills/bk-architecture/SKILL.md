---
name: bk-architecture
description: "SOLID principles, Clean Architecture layers, MVVM pattern, Repository pattern, and DI patterns for iOS (Swinject/manual), Android (Hilt/Koin), and Flutter (get_it/Riverpod)."
user-invocable: false
allowed-tools: "Read Glob Grep"
---

# Architecture Skill

> SOLID, Clean Architecture, MVVM, Repository Pattern, DI for mobile platforms

## Core Principles: SOLID

| Principle | iOS | Android | Flutter |
|-----------|-----|---------|---------|
| **S**ingle Responsibility | 1 class = 1 job | 1 class = 1 job | 1 class = 1 job |
| **O**pen/Closed | Protocol extensions | Interface + impl | Abstract class + impl |
| **L**iskov Substitution | Protocol conformance | Interface contracts | Abstract contracts |
| **I**nterface Segregation | Small protocols | Small interfaces | Small abstract classes |
| **D**ependency Inversion | Protocol injection | Hilt/Koin DI | get_it / Riverpod |

## Clean Architecture Layers

```
Presentation (Views, ViewModels, UI State)
Domain       (UseCases, Entities, Repository abstractions) — NO DEPENDENCIES
Data         (RepositoryImpl, DataSources, API)
```

### Dependency Flow (MANDATORY)

```
Presentation → Domain ← Data
              (abstractions)
```

Domain MUST NOT depend on Presentation or Data.

## Patterns per Platform

| Pattern | iOS | Android | Flutter |
|---------|-----|---------|---------|
| MVVM | `@Observable` ViewModel + Coordinator, injected use case, `@MainActor` async methods | `@HiltViewModel` + MVI intents + `StateFlow` | ViewModel/Notifier + Riverpod or Bloc |
| Repository | `protocol AuthRepository` + `AuthRepositoryImpl` over API + local store | `interface AuthRepository` + `@Inject` impl returning `Result<T>` | abstract repository + impl, mapped to domain entities |
| DI | manual container / Swinject, `lazy var` services | Hilt `@Module` + `@Provides @Singleton` | `get_it` singletons + factories |

Copy-paste implementations for all three platforms: `references/code-patterns.md`

## Modular Architecture Rules

| Rule | Description |
|------|-------------|
| MOD-001 | Feature modules MUST NOT depend on other features |
| MOD-002 | Core modules have minimal dependencies |
| MOD-003 | Domain modules MUST NOT depend on data/presentation |
| MOD-004 | Keep module interface minimal |

## State Management: Unidirectional Data Flow (UDF)

```
View → (Intent/Action) → ViewModel → (State) → View
```

- iOS: `@Observable` ViewModel + SwiftUI state bindings
- Android: `StateFlow` / `SharedFlow` in ViewModel
- Flutter: `Riverpod` StateNotifier or `Bloc` events/states
