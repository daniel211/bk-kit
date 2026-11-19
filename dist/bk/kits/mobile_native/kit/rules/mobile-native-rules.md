# Mobile Native Rules (ios + android)

## Components
- `components[]` in `.claude/platform-context.json`: `id` (`ios`/`android`), `root`, `platform`, `commands` — run each command with `cwd` = its `root`; `present: false` = not in the repo yet, plan no work for it
- A sub-task belongs to exactly ONE component; its `Files:` stay under that root
- bk-ios-developer edits only the ios component, bk-android-developer only the android one
- A feature on both clients = two sub-tasks (ios, android) in one plan, parallel when their `Files:` don't overlap

## Shared Backend Contract
- The backend (Supabase schema + RLS, or the REST OpenAPI document) is the source of truth for both clients
- Contract change = backend sub-task first (migration / spec, if the backend is in this repo), then the two client sub-tasks
- Authorization lives server-side (RLS policies / API checks) — never only in a client; no `service_role`/secret key in an app
- Never hand-edit generated client code or types; regenerate from the contract

## Parity
- Same behaviour on both clients: error codes and messages keys, validation rules, analytics event names + params, feature flags
- An intended difference (platform UX, staged rollout) is written in the plan, not discovered in review
- Shared strings / assets / event lists come from one recorded source, never copied by hand between `ios/` and `android/`

## Testing
- Each component runs its own lint/build/test; a contract change runs both
- Load the `bk-mobile-native` skill for type generation, contract drift check and the parity checklist
