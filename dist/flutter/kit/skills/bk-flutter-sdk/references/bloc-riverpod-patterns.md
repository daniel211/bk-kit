# BLoC & Riverpod Quick Reference

## When to Use Which
| Criteria | BLoC | Riverpod |
|---|---|---|
| Team preference | Event-driven, explicit | Declarative, flexible |
| Complex event flows | Preferred (transformEvents) | Possible but verbose |
| Simple state | Cubit (lighter BLoC) | StateNotifier/Notifier |
| Dependency injection | BlocProvider | Built-in (ref.read/watch) |
| Testing | bloc_test package | ProviderContainer overrides |

## BLoC with Cubit (Simple)
```dart
class CounterCubit extends Cubit<int> {
  CounterCubit() : super(0);
  void increment() => emit(state + 1);
  void decrement() => emit(state - 1);
}

// Usage
BlocProvider(
  create: (_) => CounterCubit(),
  child: BlocBuilder<CounterCubit, int>(
    builder: (context, count) => Text('$count'),
  ),
)
```

## BLoC with Events (Complex)
```dart
sealed class AuthEvent {}
class LoginRequested extends AuthEvent { final String email, password; ... }
class LogoutRequested extends AuthEvent {}

sealed class AuthState {}
class AuthInitial extends AuthState {}
class AuthLoading extends AuthState {}
class Authenticated extends AuthState { final User user; ... }
class AuthError extends AuthState { final String message; ... }

class AuthBloc extends Bloc<AuthEvent, AuthState> {
  AuthBloc({required this.authRepo}) : super(AuthInitial()) {
    on<LoginRequested>(_onLogin);
    on<LogoutRequested>(_onLogout);
  }
  // ...
}
```

## BLoC Testing
```dart
blocTest<AuthBloc, AuthState>(
  'emits [loading, authenticated] on login success',
  build: () {
    when(() => repo.login(any(), any())).thenAnswer((_) async => user);
    return AuthBloc(authRepo: repo);
  },
  act: (bloc) => bloc.add(LoginRequested(email: 'a', password: 'b')),
  expect: () => [isA<AuthLoading>(), isA<Authenticated>()],
  verify: (_) => verify(() => repo.login('a', 'b')).called(1),
);
```

## Riverpod Providers
```dart
// Simple value
final apiProvider = Provider((ref) => ApiClient());

// Async data
final userProvider = FutureProvider.family<User, String>((ref, id) async {
  return ref.read(apiProvider).fetchUser(id);
});

// Mutable state (modern)
@riverpod
class Auth extends _$Auth {
  @override
  Future<User?> build() async => null;

  Future<void> login(String email, String pass) async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(() => ref.read(apiProvider).login(email, pass));
  }
}
```

## Riverpod in Widgets
```dart
// ConsumerWidget (stateless)
class UserScreen extends ConsumerWidget {
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(userProvider(id));
    return user.when(
      data: (u) => Text(u.name),
      loading: () => CircularProgressIndicator(),
      error: (e, _) => Text('Error: $e'),
    );
  }
}

// ref.watch = reactive rebuild, ref.read = one-time read
```

## Riverpod Testing
```dart
test('auth login updates state', () async {
  final container = ProviderContainer(overrides: [
    apiProvider.overrideWithValue(MockApi()),
  ]);
  addTearDown(container.dispose);

  final notifier = container.read(authProvider.notifier);
  await notifier.login('a@b.com', 'pass');

  final state = container.read(authProvider);
  expect(state.value, isA<User>());
});
```
