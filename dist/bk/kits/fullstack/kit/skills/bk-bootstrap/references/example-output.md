# Example Bootstrap Output

This is an example of high-quality bootstrap output for an iOS MVVM project.
Use this as a reference for the level of detail and specificity expected in each foundation doc.

---

## overview.md Example (excerpt)

```markdown
---
generated: 2025-01-15T10:30:00Z
platform: ios
generator: bk-bootstrap
---

# Project Foundation: VNPay Merchant

## Identity

| Field | Value |
|-------|-------|
| App Name | VNPay Merchant |
| Platform | iOS |
| Language | Swift 5.9 |
| Package | com.vnpay.merchant |
| Entry | Sources/App/MerchantApp.swift |
| Min SDK | iOS 16.0 |

## Structure

| Directory | Files | LOC | Purpose |
|-----------|-------|-----|---------|
| Sources/App/ | 4 | 320 | App entry, DI container, AppDelegate |
| Sources/Features/Auth/ | 18 | 2,400 | Login, OTP, biometric authentication |
| Sources/Features/Payment/ | 24 | 4,100 | QR scan, transfer, top-up flows |
| Sources/Features/Home/ | 12 | 1,800 | Dashboard, notifications, quick actions |
| Sources/Core/ | 22 | 3,200 | Networking, DI, base classes, extensions |
| Sources/DesignSystem/ | 15 | 1,500 | Reusable UI components, theme tokens |
| Tests/ | 45 | 3,800 | Unit + snapshot tests |
| **Total** | **140** | **17,120** | |

## Business Context

| Field | Value |
|-------|-------|
| App Purpose | Mobile payment & merchant management for VNPay ecosystem |
| Target Users | Small-to-medium merchants accepting VNPay QR payments |
| Key Features | QR payment acceptance, transaction history, settlement reports, push notifications |

## Tech Stack Summary

| Category | Technology | Version | Notes |
|----------|-----------|---------|-------|
| UI Framework | SwiftUI | 5.9 | Primary, with UIKit wrappers for camera |
| Networking | Alamofire | 5.8.1 | REST API client |
| Image Loading | Kingfisher | 7.10 | Async image caching |
| DI | Factory | 2.3 | Property wrapper injection |
| QR Scanning | AVFoundation | native | Custom camera overlay |
| Analytics | Firebase Analytics | 10.20 | Event tracking |
| Crash Reporting | Firebase Crashlytics | 10.20 | Crash + non-fatal logging |

## Module Map

| Module | Directory | Responsibility | Key Classes | LOC |
|--------|-----------|---------------|-------------|-----|
| Auth | Sources/Features/Auth/ | Login, OTP, Biometric | AuthViewModel, OTPService, BiometricManager | 2,400 |
| Payment | Sources/Features/Payment/ | QR scan, transfer, topup | PaymentCoordinator, QRScanner, TransferViewModel | 4,100 |
| Home | Sources/Features/Home/ | Dashboard, notifications | HomeViewModel, NotificationCenter, QuickActionGrid | 1,800 |
| Core | Sources/Core/ | Networking, DI, Base classes | APIClient, AppContainer, BaseViewModel | 3,200 |
| DesignSystem | Sources/DesignSystem/ | UI components, themes | VNButton, VNTextField, VNTheme, ColorTokens | 1,500 |

## Entry Points & App Lifecycle

| Entry | File | Description |
|-------|------|-------------|
| @main | Sources/App/MerchantApp.swift | SwiftUI App entry, sets up DI container |
| AppDelegate | Sources/App/AppDelegate.swift | Push notification registration, Firebase init |
| DeepLink | Sources/App/DeepLinkHandler.swift | Handles vnpay:// scheme, universal links |
```

---

## architecture.md Example (excerpt)

```markdown
# Architecture

## Detected Patterns

| Aspect | Detected | Evidence |
|--------|----------|----------|
| Architecture | MVVM + Clean Architecture | 14 ViewModels in Sources/Features/*/ViewModels/, UseCase protocol in Sources/Core/Protocols/UseCase.swift |
| State Management | SwiftUI @Observable | @Observable macro in 11/14 ViewModels, 3 legacy ObservableObject |
| DI | Factory (property wrapper) | @Injected usage in 28 files, Container+Extensions.swift registration |
| Navigation | Coordinator pattern | 5 Coordinator classes in Sources/Features/*/Coordinators/ |
| Networking | Alamofire + async/await | APIClient.swift wraps Alamofire with async/await (line 34-67) |
| Serialization | Codable + custom decoders | 22 DTO structs with CodingKeys, custom DateDecodingStrategy in APIClient |
| Error Handling | Result<T, AppError> | Custom AppError enum in Sources/Core/Error/AppError.swift (45 lines) |

## Layer Map

| Layer | Directory | Responsibility |
|-------|-----------|---------------|
| Presentation | Sources/Features/*/Views/ | SwiftUI views, view state |
| ViewModel | Sources/Features/*/ViewModels/ | Business logic, state management |
| Domain | Sources/Core/Protocols/ | UseCase protocols, entity definitions |
| Data | Sources/Core/Network/ | API clients, DTOs, repository implementations |
| Infrastructure | Sources/Core/DI/, Sources/Core/Extensions/ | DI container, utilities |

## Dependency Graph (Layer-to-Layer)

```
Presentation (Views)
    ↓ observes
ViewModel (@Observable)
    ↓ calls
Domain (UseCase protocols)
    ↓ implemented by
Data (Repository + APIClient)
    ↓ network
Backend API (api.vnpay.vn)
```

## Pattern Details

### MVVM + Clean Architecture
Project follows MVVM with Clean Architecture boundaries:
- **Presentation**: SwiftUI Views + ViewModels (Sources/Features/*/Views/, Sources/Features/*/ViewModels/)
- **Domain**: Use cases + Entities (Sources/Core/Protocols/, Sources/Core/Models/)
- **Data**: Repositories + DTOs + API clients (Sources/Core/Network/, Sources/Features/*/Data/)

**Example Flow:**
```
LoginView → LoginViewModel → LoginUseCase → AuthRepository → APIClient → /auth/login
                ↓ (state)          ↓ (result)        ↓ (DTO→Entity)
           @Published loginState   Result<User>       UserDTO → User
```

### State Management: SwiftUI @Observable
Native @Observable macro (iOS 17+) with fallback ObservableObject for iOS 16.
- 11 ViewModels using @Observable (Sources/Features/Payment/ViewModels/, Sources/Features/Home/ViewModels/)
- 3 legacy ViewModels still on ObservableObject (AuthViewModel, SettingsViewModel, ProfileViewModel)
- Migration path: ObservableObject → @Observable when iOS 16 support dropped

### Navigation: Coordinator Pattern
5 Coordinator classes manage navigation flow:
- AppCoordinator (root), AuthCoordinator, PaymentCoordinator, HomeCoordinator, SettingsCoordinator
- NavigationStack-based with path binding in each coordinator

## Conventions Detected

| Convention | Pattern | Example | File Count |
|-----------|---------|---------|------------|
| ViewModel suffix | *ViewModel.swift | LoginViewModel.swift | 14 |
| Protocol-first | Protocol + Impl pair | AuthRepository / AuthRepositoryImpl | 8 |
| Feature folders | Features/{Name}/Views,ViewModels,Data/ | Features/Auth/Views/LoginView.swift | 5 features |
| Extension files | Type+Extension.swift | String+Validation.swift | 12 |

## Architecture Risks

- **MEDIUM**: Mixed state management — 3 ViewModels use ObservableObject while 11 use @Observable — Evidence: grep for ObservableObject in Sources/Features/
- **LOW**: Deep coordinator nesting — PaymentCoordinator has 4 child flows — Evidence: Sources/Features/Payment/Coordinators/PaymentCoordinator.swift line 45
- **INFO**: No modularization — all code in single target — Evidence: Package.swift has 1 target, 140 source files
```

---

## dependencies.md Example (excerpt)

```markdown
# Dependencies

## Source

| File | Manager |
|------|---------|
| Package.swift | Swift Package Manager |

## Core Dependencies

| Package | Version | Category | Used In |
|---------|---------|----------|---------|
| Alamofire | 5.8.1 | Networking | 8 files |
| Kingfisher | 7.10.0 | Image Loading | 12 files |
| Factory | 2.3.0 | DI | 28 files |
| Firebase/Analytics | 10.20.0 | Analytics | 5 files |
| Firebase/Crashlytics | 10.20.0 | Crash Reporting | 2 files |
| SwiftLint | 0.54.0 | Linting | Build phase |

## Risks

- Alamofire 5.8.1 lacks iOS 18 Privacy Manifest — App Store rejection risk after March 2025
- Firebase 10.20 is 2 minor versions behind — missing performance improvements
- No dependency pinning on patch versions — .upToNextMajor used for all packages

## Dependency Graph

| Package | Depends On | Used By |
|---------|-----------|---------|
| Alamofire | - | APIClient, ImageUploader |
| Kingfisher | - | AsyncImageView, ProfileImageView |
| Factory | - | Container+Extensions, all ViewModels |
| Firebase/Analytics | FirebaseCore | AnalyticsService |
| Firebase/Crashlytics | FirebaseCore | CrashReportingService |

## Version Compatibility Matrix

| Package A | Version | Package B | Version | Compatible? |
|-----------|---------|-----------|---------|------------|
| Alamofire | 5.8.1 | Swift | 5.9 | ✅ Yes |
| Firebase | 10.20 | iOS | 16.0+ | ✅ Yes |
| Factory | 2.3.0 | Swift | 5.9 | ✅ Yes |
| SwiftLint | 0.54 | Swift | 5.9 | ⚠️ Partial (new concurrency rules missing) |

## Update Recommendations

- **Alamofire** 5.8.1 → 5.9.0: Privacy manifest support required for App Store submission
- **SwiftLint** 0.54 → 0.55: New rules for Swift 5.9 concurrency patterns
- **Kingfisher** 7.10 → 7.11: Memory leak fix in prefetch module
- **Firebase** 10.20 → 10.22: Performance improvements + new consent mode API
```

---

## design-system.md Example (excerpt)

```markdown
# Design System (detected)

## Colors

| Role | Value | Usage |
|------|-------|-------|
| Primary | #1A73E8 | Buttons, links, active states |
| Secondary | #34A853 | Success states, positive amounts |
| Error | #EA4335 | Error states, negative amounts |
| Background | #FFFFFF / #1C1C1E | Light/dark mode backgrounds |
| Surface | #F5F5F5 / #2C2C2E | Card backgrounds, input fields |
| Text Primary | #202124 / #FFFFFF | Main text content |

## Component Inventory

| Component | File | Variants | Reused In |
|-----------|------|----------|-----------|
| VNButton | Sources/DesignSystem/VNButton.swift | primary, secondary, outline, destructive | 24 screens |
| VNTextField | Sources/DesignSystem/VNTextField.swift | text, password, OTP, amount | 15 screens |
| VNCard | Sources/DesignSystem/VNCard.swift | default, elevated, outline | 18 screens |
| VNLoadingView | Sources/DesignSystem/VNLoadingView.swift | fullscreen, inline, button | 20 screens |
```

---

## project-roadmap.md Example (excerpt)

```markdown
# Project Roadmap (detected)

## Current State

| Metric | Value |
|--------|-------|
| Total LOC | 17,120 |
| Total Files | 140 |
| Test Coverage | 42% (estimated from test file count vs source files) |
| Tech Debt Indicators | 23 TODOs, 5 FIXMEs, 3 deprecated API usages |

## Detected TODOs / FIXMEs

| Priority | Count | Top Files |
|----------|-------|-----------|
| FIXME | 5 | PaymentCoordinator.swift (2), APIClient.swift (2), AuthViewModel.swift (1) |
| TODO | 23 | QRScannerView.swift (4), TransferViewModel.swift (3), HomeViewModel.swift (3) |
| HACK | 2 | CameraOverlay.swift (1), DeepLinkHandler.swift (1) |

## Suggested Improvements

### Migrate ObservableObject → @Observable
- **Impact**: High — consistency, performance, less boilerplate
- **Effort**: Low — 3 ViewModels to migrate
- **Evidence**: AuthViewModel.swift, SettingsViewModel.swift, ProfileViewModel.swift still use ObservableObject
- **Recommendation**: Migrate when iOS 16 support is dropped (check min deployment target)

### Add Modularization (SPM Packages)
- **Impact**: High — faster builds, clearer boundaries, testability
- **Effort**: Medium — split into Core, Features, DesignSystem packages
- **Evidence**: Single target with 140 files, build time ~45s
- **Recommendation**: Start with DesignSystem package extraction, then Core

## Migration Opportunities

- **ObservableObject** → **@Observable**: 3 ViewModels pending, requires iOS 17+ minimum (Low effort)
- **UIKit Camera** → **SwiftUI Camera**: CameraOverlay.swift uses UIViewRepresentable wrapper (Medium effort)
- **Alamofire** → **native URLSession async/await**: Reduce dependency, Apple-recommended path (High effort)
```
