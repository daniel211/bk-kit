---
name: bk-ios
description: "Swift/SwiftUI patterns + XCTest. Platform knowledge for bk-ios-developer."
user-invocable: false
---

# bk-ios Platform Knowledge

Code patterns and examples for iOS development with Swift/SwiftUI and XCTest.

---

## SwiftUI Patterns

### View Composition
```swift
struct UserProfileView: View {
    @State private var viewModel: UserProfileViewModel

    init(userId: String) {
        _viewModel = State(initialValue: UserProfileViewModel(userId: userId))
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                headerSection
                statsSection
                actionsSection
            }
            .padding()
        }
        .task { await viewModel.load() }
    }

    private var headerSection: some View {
        VStack {
            AsyncImage(url: viewModel.avatarURL) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                ProgressView()
            }
            .frame(width: 80, height: 80)
            .clipShape(Circle())

            Text(viewModel.name).font(.title2.bold())
        }
    }
}
```

### @Observable ViewModel (Swift 5.9+)
```swift
@Observable
final class UserProfileViewModel {
    var name: String = ""
    var avatarURL: URL?
    var isLoading = false
    var error: String?

    private let userId: String
    private let repository: UserRepository

    init(userId: String, repository: UserRepository = .shared) {
        self.userId = userId
        self.repository = repository
    }

    @MainActor
    func load() async {
        isLoading = true
        defer { isLoading = false }

        do {
            let user = try await repository.fetchUser(id: userId)
            name = user.name
            avatarURL = user.avatarURL
        } catch {
            self.error = error.localizedDescription
        }
    }
}
```

### Navigation (NavigationStack)
```swift
struct AppNavigator: View {
    @State private var path = NavigationPath()

    var body: some View {
        NavigationStack(path: $path) {
            HomeView()
                .navigationDestination(for: Route.self) { route in
                    switch route {
                    case .profile(let id): UserProfileView(userId: id)
                    case .settings: SettingsView()
                    }
                }
        }
        .environment(\.navigate, { path.append($0) })
    }
}

enum Route: Hashable {
    case profile(String)
    case settings
}
```

### Loading / Error / Empty States
```swift
struct AsyncContentView<T, Content: View>: View {
    let state: LoadingState<T>
    let content: (T) -> Content

    var body: some View {
        switch state {
        case .idle: EmptyView()
        case .loading: ProgressView()
        case .loaded(let data): content(data)
        case .empty: ContentUnavailableView("No Data", systemImage: "tray")
        case .error(let message):
            ContentUnavailableView("Error", systemImage: "exclamationmark.triangle") {
                Text(message)
            }
        }
    }
}

enum LoadingState<T> {
    case idle, loading, loaded(T), empty, error(String)
}
```

---

## XCTest Patterns

### Basic Test Setup
```swift
import XCTest
@testable import App

final class UserRepositoryTests: XCTestCase {
    private var sut: UserRepository!
    private var mockAPI: MockAPIClient!

    override func setUp() {
        super.setUp()
        mockAPI = MockAPIClient()
        sut = UserRepository(api: mockAPI)
    }

    override func tearDown() {
        sut = nil
        mockAPI = nil
        super.tearDown()
    }

    func test_fetchUser_returnsUser() async throws {
        mockAPI.stubbedResponse = User(id: "1", name: "Test")

        let user = try await sut.fetchUser(id: "1")

        XCTAssertEqual(user.name, "Test")
        XCTAssertEqual(mockAPI.fetchCalledCount, 1)
    }

    func test_fetchUser_throwsOnNetworkError() async {
        mockAPI.shouldThrow = true

        do {
            _ = try await sut.fetchUser(id: "1")
            XCTFail("Expected error")
        } catch {
            XCTAssertTrue(error is NetworkError)
        }
    }
}
```

### Async Testing
```swift
func test_publisherEmitsValues() async {
    let expectation = expectation(description: "values emitted")
    var received: [String] = []

    sut.valuesPublisher
        .sink { received.append($0) }
        .store(in: &cancellables)

    sut.loadValues()

    await fulfillment(of: [expectation], timeout: 2.0)
    XCTAssertEqual(received, ["a", "b", "c"])
}
```

### @MainActor Testing
```swift
@MainActor
final class LoginViewModelTests: XCTestCase {
    func test_login_updatesState() async {
        let vm = LoginViewModel(auth: MockAuthService())

        await vm.login(email: "test@test.com", password: "pass")

        XCTAssertTrue(vm.isLoggedIn)
        XCTAssertNil(vm.errorMessage)
    }
}
```

### Fake Implementation (preferred over mocks)
```swift
class FakeUserStore: UserStoreProtocol {
    var users: [String: User] = [:]

    func save(_ user: User) async throws {
        users[user.id] = user
    }

    func fetch(id: String) async throws -> User? {
        return users[id]
    }
}
```
