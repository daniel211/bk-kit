# Shared Backend Contract (Swift iOS + Kotlin Android)

Paths assume an `ios/` and an `android/` component plus the backend at `supabase/` (or
`api/openapi.yaml` for REST); use the real `components[].root` values. Everything under
`contract/` is committed and owned by the backend sub-task.

```
supabase/migrations/   supabase/functions/   supabase/tests/   supabase/seed.sql
contract/fixtures/*.json   contract/schema/database.ts   contract/events.json   contract/export-fixtures.sh
ios/App/Generated/Database.swift            android/app/src/main/.../data/remote/dto/
```

## 1. Supabase: the schema is the contract

### Migrations (backend sub-task, before any client work)
```bash
supabase migration new add_order_status      # writes supabase/migrations/<ts>_add_order_status.sql
supabase db reset                            # local DB = all migrations + seed.sql
supabase test db                             # pgTAP tests in supabase/tests/
supabase db diff -f add_order_status         # only when the change was made in Studio first
```
Additive changes (new nullable column, new table, new enum value) are safe for shipped apps.
Renaming / dropping a column or making it NOT NULL without a default breaks every installed
version: add the new column, ship both apps reading it, then drop the old one in a later release.

### RLS is the authorization layer
```sql
alter table public.orders enable row level security;

create policy "own orders: read" on public.orders
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "own orders: insert" on public.orders
  for insert to authenticated with check ((select auth.uid()) = user_id);
```
- Every table in an exposed schema has RLS enabled and a policy per operation the apps use;
  a pgTAP test proves a second user cannot read or write the first user's rows.
- A client-side check (hiding a button, filtering a list) is UX, never authorization.
- Apps ship only the publishable / `anon` key. The `service_role` / secret key lives in Edge
  Function secrets or the server — never in `Info.plist`, `xcconfig`, `BuildConfig` or
  `local.properties` that ships in a build.
- Privileged writes go through an RPC (`security definer` with an explicit `search_path` and its
  own checks) or an Edge Function, not through a broader table policy.

### Swift: generated types
`supabase gen types` supports `--lang typescript` (default), `go` and `swift` (recent CLIs also
`python`). There is **no Kotlin target** — do not pass `--lang kotlin`.
```bash
# cwd = repo root, after `supabase db reset`; flags differ by CLI version — check `supabase gen types --help`
supabase gen types --lang swift --schema public --swift-access-control internal \
  > ios/App/Generated/Database.swift
supabase gen types --lang typescript --schema public > contract/schema/database.ts
```
- Recent CLIs build the Swift generator from supabase-swift source: the job needs a Swift
  toolchain (run it on macOS). The TypeScript snapshot needs nothing extra, so it is the cheap
  schema snapshot every CI job can diff — commit it even with no web client.
- Generated files are committed and never edited by hand; wrap them in domain models in the
  data layer instead of leaking them into views.
```swift
let orders: [Order] = try await supabase
  .from("orders").select().eq("user_id", value: userId).execute().value
```

### Kotlin: hand-written DTOs held to the schema by fixtures
No official generator exists, so keep DTOs in one package and make drift fail a test:
```kotlin
@Serializable
data class OrderDto(
    val id: String,
    @SerialName("user_id") val userId: String,
    val status: OrderStatusDto,
    @SerialName("total_cents") val totalCents: Long,
    @SerialName("created_at") val createdAt: Instant,   // kotlinx-datetime
)

@Serializable
enum class OrderStatusDto { @SerialName("pending") PENDING, @SerialName("paid") PAID }

val orders = supabase.from("orders").select { filter { eq("user_id", userId) } }.decodeList<OrderDto>()
```
- Production `Json` uses `ignoreUnknownKeys = true` (an added column must not crash a shipped
  app); the **fixture test** uses `ignoreUnknownKeys = false`, so a new column fails until the
  DTO is updated on purpose.
- Every Postgres enum value has a `@SerialName`; the fixture covers each value.
- Optional: generate Kotlin from a JSON Schema or OpenAPI you maintain for Edge Functions
  (`openapi-generator`, §2). Do not depend on PostgREST's auto-generated spec as the contract.

### Fixtures: one source both clients decode
Rows exported from the seeded local DB (default local URL shown; never a production DB):
```bash
DB=postgresql://postgres:postgres@127.0.0.1:54322/postgres
psql "$DB" -Atc "select coalesce(json_agg(t), '[]') from (select * from public.orders order by id limit 3) t" \
  | jq . > contract/fixtures/orders.json
```
- `seed.sql` holds at least one row per enum value and per nullable field set / unset.
- iOS test decodes it into the generated type (`JSONDecoder` with the same date strategy the
  client uses); Android test decodes it into `OrderDto` with the strict `Json`.
- Edge Functions and RPCs: commit a request and a response fixture per function
  (`contract/fixtures/fn-create-checkout.request.json`); the function's test and both clients'
  tests use the same files.

### Errors
PostgREST errors carry `code`, `message`, `details`, `hint`. Map them once per client to one
`AppError` and branch on `code`, never on `message`:

| code | meaning | client behaviour |
|------|---------|------------------|
| `42501` | RLS / privilege denied | treat as forbidden; never retry |
| `23505` | unique violation | field-level "already exists" |
| `PGRST116` | `.single()` matched 0 or >1 rows | not found |
| HTTP 401 / JWT expired | session invalid | refresh once, then sign out |

Edge Functions return one envelope `{"error": {"code", "message"}}`; error string keys are
`error.<code>` in both apps' localization files.

### Auth session storage
- supabase-swift keeps the session in the Keychain by default.
- supabase-kt's default session storage on Android is not Keystore-backed: supply a custom
  `SessionManager` that encrypts with an Android Keystore key.
- Same redirect URL scheme registered for both apps (`Info.plist` URL types, Android intent
  filter) and in Supabase Auth's allowed redirect URLs; PKCE flow on both.

## 2. REST backend: OpenAPI is the contract

The backend commits `api/openapi.yaml`; both clients generate from that exact file.

### Swift — swift-openapi-generator (build plugin)
```swift
// Package.swift of the API client package
dependencies: [
  .package(url: "https://github.com/apple/swift-openapi-generator", from: "1.0.0"),
  .package(url: "https://github.com/apple/swift-openapi-runtime", from: "1.0.0"),
  .package(url: "https://github.com/apple/swift-openapi-urlsession", from: "1.0.0"),
],
targets: [
  .target(name: "APIClient",
    dependencies: [.product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
                   .product(name: "OpenAPIURLSession", package: "swift-openapi-urlsession")],
    plugins: [.plugin(name: "OpenAPIGenerator", package: "swift-openapi-generator")]),
]
```
`Sources/APIClient/openapi-generator-config.yaml`: `generate: [types, client]`,
`accessModifier: internal`. `Sources/APIClient/openapi.yaml` is a copy of `api/openapi.yaml`
refreshed by a script (CI fails if they differ). Generated code lives in the build directory,
so drift shows up as a compile error.

### Kotlin — openapi-generator Gradle plugin
```kotlin
plugins { id("org.openapi.generator") version "<pinned>" }

openApiGenerate {
    generatorName.set("kotlin")
    library.set("jvm-retrofit2")            // or "jvm-ktor"
    inputSpec.set("$rootDir/../api/openapi.yaml")
    outputDir.set(layout.buildDirectory.dir("generated/openapi").get().asFile.path)
    packageName.set("com.example.api")
    configOptions.put("serializationLibrary", "kotlinx_serialization")
}
kotlin.sourceSets["main"].kotlin.srcDir(layout.buildDirectory.dir("generated/openapi/src/main/kotlin"))
tasks.named("preBuild") { dependsOn("openApiGenerate") }
```

### Versioning
Breaking change = new path (`/v2/...`) kept alongside the old one until the oldest supported
app version (forced-update floor) no longer calls it. Both apps send their version in a header
so the backend can measure that.

## 3. CI drift check

```yaml
jobs:
  contract:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
      - run: supabase start && supabase db reset
      - run: supabase test db
      - run: supabase gen types --lang typescript --schema public > contract/schema/database.ts
      - run: ./contract/export-fixtures.sh
      - run: git diff --exit-code -- contract/
  ios:
    needs: contract
    runs-on: macos-latest
    steps:
      # regenerate ios/App/Generated/Database.swift (needs local DB), then:
      - run: git diff --exit-code -- ios/App/Generated/
      - run: xcodebuild test -scheme App -destination 'platform=iOS Simulator,name=iPhone 16'
  android:
    needs: contract
    runs-on: ubuntu-latest
    steps:
      - run: ./gradlew testDebugUnitTest   # cwd = android; strict fixture decode lives here
```
Pin the action and CLI versions in the real workflow. A REST backend replaces the Supabase
steps with "re-export `openapi.yaml` + `git diff --exit-code`"; both client builds then
regenerate from it.

## 4. Feature parity checklist (per feature, in the plan)

- [ ] Contract: the same tables / RPCs / endpoints and fields used by both clients
- [ ] Validation: same rules and limits (length, format, required) on both, and enforced server-side
- [ ] Errors: same `code` → same user-facing string key and recovery action
- [ ] Empty / loading / offline states: both handle them (mobile-shared-rules UI/UX)
- [ ] Analytics: event names + params from `contract/events.json`, fired at the same moments
- [ ] Feature flag: same key and default on both
- [ ] Strings: same keys, one translation source exported to `Localizable.xcstrings` and `strings.xml`
- [ ] Auth: same session expiry handling and sign-out path
- [ ] Deep links / push payloads: same URL paths and payload fields
- [ ] Tests: fixture decode test on both; one UI test of the critical flow per platform
- [ ] Intended differences listed in the plan with the reason
