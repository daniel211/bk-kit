# context7.com Mobile SDK URL Patterns

Reference for direct context7.com URLs when automatic lookup fails.
Pattern: `https://context7.com/{org}/{repo}/llms.txt[?topic={keyword}]`

## iOS / Swift

| Library | context7 URL | Topic Examples |
|---------|-------------|----------------|
| SwiftUI | `https://context7.com/apple/swiftui/llms.txt` | `navigation`, `animation`, `state`, `layout` |
| UIKit | `https://context7.com/apple/uikit/llms.txt` | `viewcontroller`, `tableview`, `autolayout` |
| Swift stdlib | `https://context7.com/apple/swift/llms.txt` | `concurrency`, `generics`, `protocols` |
| SwiftData | `https://context7.com/apple/swiftdata/llms.txt` | `model`, `query`, `migration` |
| Combine | `https://context7.com/apple/swift-combine/llms.txt` | `publisher`, `subscriber`, `operator` |
| Alamofire | `https://context7.com/Alamofire/Alamofire/llms.txt` | `request`, `upload`, `authentication` |
| Moya | `https://context7.com/Moya/Moya/llms.txt` | `target`, `provider`, `plugin` |
| Kingfisher | `https://context7.com/onevcat/Kingfisher/llms.txt` | `cache`, `processor`, `download` |
| RxSwift | `https://context7.com/ReactiveX/RxSwift/llms.txt` | `observable`, `subject`, `dispose` |
| Realm (Swift) | `https://context7.com/realm/realm-swift/llms.txt` | `object`, `query`, `migration` |
| Firebase iOS | `https://context7.com/firebase/firebase-ios-sdk/llms.txt` | `auth`, `firestore`, `crashlytics` |

## Android / Kotlin

| Library | context7 URL | Topic Examples |
|---------|-------------|----------------|
| Jetpack Compose | `https://context7.com/jetbrains/compose-multiplatform/llms.txt` | `state`, `modifier`, `navigation`, `lazycolumn` |
| Material3 | `https://context7.com/material-components/material-components-android/llms.txt` | `theming`, `button`, `card` |
| Retrofit | `https://context7.com/square/retrofit/llms.txt` | `service`, `converter`, `interceptor` |
| Coil | `https://context7.com/coil-kt/coil/llms.txt` | `asyncimage`, `loader`, `cache` |
| Hilt (Dagger) | `https://context7.com/google/dagger/llms.txt` | `module`, `component`, `inject` |

## Flutter / Dart

| Library | context7 URL | Topic Examples |
|---------|-------------|----------------|
| Flutter | `https://context7.com/flutter/flutter/llms.txt` | `widget`, `state`, `navigation`, `platform-channel` |
| Dart | `https://context7.com/dart-lang/dart/llms.txt` | `async`, `streams`, `isolates` |
| Riverpod | `https://context7.com/rrousselGit/riverpod/llms.txt` | `provider`, `notifier`, `ref` |
| Provider | `https://context7.com/rrousselGit/provider/llms.txt` | `changenotifier`, `consumer`, `context` |

## Usage Notes

- Add `?topic=<keyword>` for targeted results (fewer tokens, more relevant)
- If a URL returns 404, the SDK may not be indexed on context7.com yet — fall back to web search
- Topic keywords should be single lowercase words or hyphenated phrases
- For Apple first-party frameworks, try `apple/` prefix first; some may be under `websites/developer.apple.com`
