---
name: bk-flutter-sdk
description: "Dart/Flutter patterns + flutter_test/mocktail. Platform knowledge for bk-flutter-developer."
user-invocable: false
---

# bk-flutter-sdk Platform Knowledge

Code patterns and examples for Flutter development with BLoC/Riverpod state management and flutter_test/mocktail.

---

## BLoC & Riverpod Patterns

### BLoC Pattern
```dart
// Events
sealed class UserEvent {}
class FetchUser extends UserEvent {
  final String id;
  FetchUser(this.id);
}
class RefreshUser extends UserEvent {}

// States
sealed class UserState {}
class UserInitial extends UserState {}
class UserLoading extends UserState {}
class UserLoaded extends UserState {
  final User user;
  UserLoaded(this.user);
}
class UserError extends UserState {
  final String message;
  UserError(this.message);
}

// BLoC
class UserBloc extends Bloc<UserEvent, UserState> {
  final UserRepository repository;

  UserBloc({required this.repository}) : super(UserInitial()) {
    on<FetchUser>(_onFetch);
    on<RefreshUser>(_onRefresh);
  }

  Future<void> _onFetch(FetchUser event, Emitter<UserState> emit) async {
    emit(UserLoading());
    try {
      final user = await repository.fetchUser(event.id);
      emit(UserLoaded(user));
    } catch (e) {
      emit(UserError(e.toString()));
    }
  }

  Future<void> _onRefresh(RefreshUser event, Emitter<UserState> emit) async {
    // Re-fetch without loading state for pull-to-refresh
    try {
      final user = await repository.fetchUser((state as UserLoaded).user.id);
      emit(UserLoaded(user));
    } catch (e) {
      emit(UserError(e.toString()));
    }
  }
}
```

### BLoC in Widget
```dart
class UserScreen extends StatelessWidget {
  final String userId;
  const UserScreen({super.key, required this.userId});

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (context) => UserBloc(repository: context.read<UserRepository>())
        ..add(FetchUser(userId)),
      child: BlocBuilder<UserBloc, UserState>(
        builder: (context, state) => switch (state) {
          UserInitial() || UserLoading() => const CircularProgressIndicator(),
          UserLoaded(:final user) => UserContent(user: user),
          UserError(:final message) => ErrorWidget(message: message),
        },
      ),
    );
  }
}
```

### Riverpod Pattern
```dart
// Provider
final userRepositoryProvider = Provider<UserRepository>((ref) {
  return UserRepositoryImpl(api: ref.read(apiClientProvider));
});

final userProvider = FutureProvider.family<User, String>((ref, userId) async {
  final repo = ref.read(userRepositoryProvider);
  return repo.fetchUser(userId);
});

// AsyncNotifier (for mutable state)
final userNotifierProvider = AsyncNotifierProvider<UserNotifier, User>(UserNotifier.new);

class UserNotifier extends AsyncNotifier<User> {
  @override
  Future<User> build() async {
    final repo = ref.read(userRepositoryProvider);
    return repo.fetchCurrentUser();
  }

  Future<void> updateName(String name) async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(() async {
      final repo = ref.read(userRepositoryProvider);
      return repo.updateName(name);
    });
  }
}
```

### Riverpod in Widget
```dart
class UserScreen extends ConsumerWidget {
  final String userId;
  const UserScreen({super.key, required this.userId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final userAsync = ref.watch(userProvider(userId));

    return userAsync.when(
      data: (user) => UserContent(user: user),
      loading: () => const CircularProgressIndicator(),
      error: (error, stack) => ErrorWidget(message: error.toString()),
    );
  }
}
```

---

## Flutter Test Patterns

### Unit Test Setup (mocktail)
```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

class MockUserRepository extends Mock implements UserRepository {}

void main() {
  late MockUserRepository mockRepo;
  late UserBloc sut;

  setUp(() {
    mockRepo = MockUserRepository();
    sut = UserBloc(repository: mockRepo);
  });

  tearDown(() => sut.close());

  group('UserBloc', () {
    test('emits [loading, loaded] on successful fetch', () async {
      when(() => mockRepo.fetchUser('1'))
          .thenAnswer((_) async => User(id: '1', name: 'Test'));

      sut.add(FetchUser('1'));

      await expectLater(
        sut.stream,
        emitsInOrder([
          isA<UserLoading>(),
          isA<UserLoaded>().having((s) => s.user.name, 'name', 'Test'),
        ]),
      );
    });

    test('emits [loading, error] on failure', () async {
      when(() => mockRepo.fetchUser(any()))
          .thenThrow(NetworkException('timeout'));

      sut.add(FetchUser('1'));

      await expectLater(
        sut.stream,
        emitsInOrder([isA<UserLoading>(), isA<UserError>()]),
      );
    });
  });
}
```

### Widget Test
```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('UserCard displays name and avatar', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: UserCard(user: User(id: '1', name: 'Test', avatarUrl: null)),
      ),
    );

    expect(find.text('Test'), findsOneWidget);
    expect(find.byType(CircleAvatar), findsOneWidget);
  });

  testWidgets('LoginForm validates empty email', (tester) async {
    await tester.pumpWidget(MaterialApp(home: LoginForm()));

    await tester.tap(find.byType(ElevatedButton));
    await tester.pump();

    expect(find.text('Email is required'), findsOneWidget);
  });
}
```

### Fake Implementation
```dart
class FakeUserRepository implements UserRepository {
  final Map<String, User> _users = {};

  @override
  Future<User> fetchUser(String id) async {
    final user = _users[id];
    if (user == null) throw NotFoundException('User $id not found');
    return user;
  }

  @override
  Future<void> saveUser(User user) async {
    _users[user.id] = user;
  }

  void seed(List<User> users) {
    for (final user in users) {
      _users[user.id] = user;
    }
  }
}
```

### Golden Test
```dart
testWidgets('UserProfile matches golden', (tester) async {
  await tester.pumpWidget(
    MaterialApp(
      home: UserProfileScreen(user: testUser),
    ),
  );

  await expectLater(
    find.byType(UserProfileScreen),
    matchesGoldenFile('goldens/user_profile.png'),
  );
});
```

### BLoC Testing with bloc_test
```dart
import 'package:bloc_test/bloc_test.dart';

void main() {
  blocTest<UserBloc, UserState>(
    'emits [loading, loaded] when FetchUser succeeds',
    build: () {
      when(() => mockRepo.fetchUser('1'))
          .thenAnswer((_) async => testUser);
      return UserBloc(repository: mockRepo);
    },
    act: (bloc) => bloc.add(FetchUser('1')),
    expect: () => [isA<UserLoading>(), isA<UserLoaded>()],
  );
}
```

### Riverpod Testing
```dart
void main() {
  test('userProvider returns user', () async {
    final container = ProviderContainer(
      overrides: [
        userRepositoryProvider.overrideWithValue(FakeUserRepository()..seed([testUser])),
      ],
    );

    final user = await container.read(userProvider('1').future);
    expect(user.name, 'Test');
    container.dispose();
  });
}
```
