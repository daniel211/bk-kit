# SwiftUI Quick Reference

## MVVM with @Observable (Swift 5.9+)
```swift
@Observable
final class ItemViewModel {
    var items: [Item] = []
    var isLoading = false
    private let repo: ItemRepository

    init(repo: ItemRepository) { self.repo = repo }

    @MainActor func load() async {
        isLoading = true
        defer { isLoading = false }
        items = (try? await repo.fetchAll()) ?? []
    }
}
```

## Legacy @ObservableObject (pre-5.9)
```swift
class ItemViewModel: ObservableObject {
    @Published var items: [Item] = []
    @Published var isLoading = false
}
// Use @StateObject for creation, @ObservedObject for injection
```

## View Composition
```swift
struct ItemListView: View {
    @State private var vm = ItemViewModel(repo: .shared)

    var body: some View {
        List(vm.items) { item in
            ItemRow(item: item)
        }
        .overlay { if vm.isLoading { ProgressView() } }
        .task { await vm.load() }
    }
}

// Extract subviews as computed properties or separate structs
private var emptyState: some View { ... }
```

## State Management Cheat Sheet
| Property Wrapper | Use Case |
|---|---|
| `@State` | Local value types |
| `@Binding` | Two-way child reference |
| `@Environment` | Injected dependencies/system values |
| `@Observable` + `@State` | ViewModel (Swift 5.9+) |
| `@StateObject` | ViewModel creation (pre-5.9) |
| `@ObservedObject` | ViewModel passed in (pre-5.9) |

## NavigationStack
```swift
@State private var path = NavigationPath()

NavigationStack(path: $path) {
    List(items) { item in
        NavigationLink(value: item) { Text(item.name) }
    }
    .navigationDestination(for: Item.self) { item in
        DetailView(item: item)
    }
}
```

## Preview Patterns
```swift
#Preview("Default") { ItemRow(item: .preview) }
#Preview("Loading") { ItemListView().environment(\.isLoading, true) }

// Preview data extension
extension Item {
    static let preview = Item(id: "1", name: "Sample")
}
```

## Sheet / Alert
```swift
@State private var showSheet = false
@State private var alertItem: AlertItem?

.sheet(isPresented: $showSheet) { EditView() }
.alert(item: $alertItem) { item in
    Button("OK") { }
} message: { item in Text(item.message) }
```

## SwiftUI Patterns — full examples

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
