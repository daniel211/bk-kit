# Platform Build Commands (bk-code-workflow)

`build_verified: true` in an impl report means one of these ran and passed. Never set it from
inspection.

| Platform | Verify Command |
|----------|---------------|
| iOS | `xcodebuild build -scheme {scheme} -destination 'platform=iOS Simulator,name=iPhone 15'` |
| Android | `./gradlew assembleDebug` |
| Flutter | `flutter analyze && flutter test` |

**Build retry:** max 3 retries per build failure. After 3 failures, return `status: "partial"`
with the error details.

## `fix_details` schema (impl report frontmatter)

```yaml
fix_details:
  retry_number: 1
  failures_addressed: [test_name_1]
  changes_made:
    - file: path/to/file
      fix: "description"
      line: 42
  ready_for_retest: true
```
