# Mobile Shared Rules

## Architecture
- Clean Architecture: data -> domain -> presentation
- MVVM pattern for presentation layer
- Repository pattern for data layer
- Use case / Interactor for business logic
- Dependency injection required

## API Integration
- RESTful client with interceptor (auth token, logging, retry)
- Request/Response models separate from domain models
- Centralized error handling (network, server, parse errors)
- Timeout: connect 10s, read 30s, write 30s

## Offline-First
- Local database for critical data
- Queue mechanism for pending operations
- Conflict resolution strategy (server-wins default)
- Sync indicator in UI

## Security
- Never hardcode API keys/secrets in source code
- Secure storage for tokens (Keychain/Keystore/FlutterSecureStorage)
- Certificate pinning for production
- Biometric authentication when required
- Code obfuscation: ProGuard/R8 (Android), bitcode (iOS)

## UI/UX Standards
- Platform-native patterns (Material Design / HIG)
- Loading states for all async operations
- Empty states, error states with retry action
- Pull-to-refresh for list screens
- Skeleton loading preferred over spinners
- Haptic feedback for critical actions

## Testing
- Unit test: business logic, repositories, use cases (>80% coverage)
- Widget/UI test: critical user flows
- Integration test: API, database operations
- Prefer fakes/in-memory implementations over excessive mocking

## CI/CD
- Fastlane for build automation
- Semantic versioning: MAJOR.MINOR.PATCH+BUILD
- Changelog from conventional commits
- Environment configs: dev, staging, production

## Git
- Branch: feature/TICKET-description, fix/TICKET-description
- PR template with checklist: tests, screenshots, breaking changes
- Squash merge to main
- Tag releases: v1.2.3
