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
