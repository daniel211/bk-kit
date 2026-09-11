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
