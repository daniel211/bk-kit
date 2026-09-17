# Flutter Test Quick Reference

## Test Types
| Type | Location | Command |
|---|---|---|
| Unit | `test/` | `flutter test` |
| Widget | `test/` | `flutter test` |
| Integration | `integration_test/` | `flutter test integration_test` |

## Unit Test with Mocktail
```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

class MockRepo extends Mock implements UserRepository {}

void main() {
  late MockRepo repo;
  setUp(() => repo = MockRepo());

  test('fetchUser returns user', () async {
    when(() => repo.fetchUser('1')).thenAnswer((_) async => testUser);
    final result = await repo.fetchUser('1');
    expect(result.name, 'Test');
    verify(() => repo.fetchUser('1')).called(1);
  });

  test('fetchUser throws on error', () {
    when(() => repo.fetchUser(any())).thenThrow(NetworkException());
    expect(() => repo.fetchUser('1'), throwsA(isA<NetworkException>()));
  });
}
```

## Widget Test
```dart
testWidgets('shows title and handles tap', (tester) async {
  var tapped = false;
  await tester.pumpWidget(MaterialApp(
    home: MyButton(title: 'Click', onTap: () => tapped = true),
  ));

  expect(find.text('Click'), findsOneWidget);
  await tester.tap(find.byType(MyButton));
  await tester.pump();  // Rebuild after state change
  expect(tapped, isTrue);
});
```

## Finder Patterns
```dart
find.text('Hello')                    // By text
find.byType(ElevatedButton)          // By widget type
find.byKey(const Key('submit'))      // By key
find.byIcon(Icons.add)              // By icon
find.descendant(of: find.byType(Card), matching: find.text('Title'))
```

## pump vs pumpAndSettle
```dart
await tester.pump();           // Single frame rebuild
await tester.pump(Duration(seconds: 1));  // Advance by duration
await tester.pumpAndSettle();  // Pump until no pending frames (animations done)
// Warning: pumpAndSettle times out with infinite animations (e.g. CircularProgressIndicator)
```

## Common Matchers
```dart
expect(value, equals(42));
expect(list, contains('item'));
expect(widget, findsOneWidget);
expect(widget, findsNothing);
expect(widget, findsNWidgets(3));
expect(future, throwsA(isA<FormatException>()));
expect(value, isNull / isNotNull / isTrue / isFalse);
```

## Golden Tests
```dart
testWidgets('matches golden', (tester) async {
  await tester.pumpWidget(MaterialApp(home: MyWidget()));
  await expectLater(find.byType(MyWidget), matchesGoldenFile('goldens/my_widget.png'));
});
// Run: flutter test --update-goldens
```

## Integration Test
```dart
import 'package:integration_test/integration_test.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('full login flow', (tester) async {
    app.main();
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(Key('email')), 'user@test.com');
    await tester.tap(find.text('Login'));
    await tester.pumpAndSettle();
    expect(find.text('Welcome'), findsOneWidget);
  });
}
```

## Flutter Test Patterns — full examples

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
