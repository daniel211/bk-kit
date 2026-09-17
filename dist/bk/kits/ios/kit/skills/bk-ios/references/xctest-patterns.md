# XCTest Quick Reference

## Test Naming Convention
```
test_<methodUnderTest>_<scenario>_<expectedBehavior>()
// e.g. test_login_withInvalidEmail_showsError()
```

## Common Assertions
```swift
XCTAssertEqual(actual, expected)
XCTAssertTrue(condition)
XCTAssertNil(optional)
XCTAssertThrowsError(try expr) { error in ... }
XCTAssertNoThrow(try expr)
XCTFail("should not reach here")
```

## Async Testing
```swift
// async/await (preferred)
func test_fetch_returnsData() async throws {
    let result = try await sut.fetch()
    XCTAssertEqual(result.count, 3)
}

// Expectation-based (for Combine/callbacks)
func test_publisher_emitsValue() {
    let exp = expectation(description: "emits")
    sut.publisher.sink { _ in exp.fulfill() }.store(in: &cancellables)
    sut.trigger()
    wait(for: [exp], timeout: 2.0)
}
```

## Protocol-Based Mocks
```swift
protocol AuthServiceProtocol {
    func login(email: String, password: String) async throws -> User
}

class MockAuthService: AuthServiceProtocol {
    var loginResult: Result<User, Error> = .failure(TestError.notStubbed)
    var loginCallCount = 0

    func login(email: String, password: String) async throws -> User {
        loginCallCount += 1
        return try loginResult.get()
    }
}
```

## UI Testing
```swift
final class LoginUITests: XCTestCase {
    let app = XCUIApplication()

    override func setUp() {
        continueAfterFailure = false
        app.launchArguments = ["--uitesting"]
        app.launch()
    }

    func test_loginFlow() {
        app.textFields["email"].tap()
        app.textFields["email"].typeText("user@test.com")
        app.secureTextFields["password"].tap()
        app.secureTextFields["password"].typeText("pass123")
        app.buttons["Login"].tap()

        XCTAssertTrue(app.staticTexts["Welcome"].waitForExistence(timeout: 5))
    }
}
```

## @MainActor Tests
```swift
@MainActor
final class ViewModelTests: XCTestCase {
    func test_action_updatesPublishedState() async {
        let vm = MyViewModel(service: MockService())
        await vm.performAction()
        XCTAssertEqual(vm.state, .success)
    }
}
```

## XCTest Patterns — full examples

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
