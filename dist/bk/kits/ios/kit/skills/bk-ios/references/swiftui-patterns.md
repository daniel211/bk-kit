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
