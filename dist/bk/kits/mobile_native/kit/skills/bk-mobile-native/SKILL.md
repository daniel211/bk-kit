---
name: bk-mobile-native
description: "Native iOS + Android apps in one repo sharing one backend (Supabase or REST): contract source of truth, generated Swift types / Kotlin DTOs, contract drift check in CI, feature parity checklist. Platform knowledge for bk-ios-developer and bk-android-developer in mobile_native projects."
user-invocable: false
---

# bk-mobile-native Platform Knowledge

Glue between the ios component (Swift) and the android component (Kotlin) of one repo, and the
backend both call. Component patterns stay in `bk-ios` and `bk-android`; this skill covers only
what the two clients share. **Read `references/shared-backend-contract.md` before changing a
table, RLS policy, RPC, Edge Function or endpoint a client calls, the generated types / DTOs,
or a behaviour that must match on both platforms.**

## Components

Read `components[]` from `.claude/platform-context.json`: each has `id` (`ios` / `android`),
`root`, `platform`, `commands`, and `present: false` when that app is not in the repo yet.
Run a component's commands with `cwd` = its `root`. Edit only files under your own component's
root; if a change needs the other client or the backend, report it as a follow-up sub-task
instead of editing it.

## House conventions

- **Contract**: the backend is the source of truth — Supabase migrations + RLS policies under
  `supabase/`, or a committed OpenAPI document for a REST backend. Clients never invent a column,
  field or enum value the contract does not have.
- **Order**: contract change = backend sub-task (migration / spec + its tests) first, then one
  ios and one android sub-task (regenerate / adapt + tests), parallel with each other.
- **Types**: Swift types are generated (`supabase gen types --lang swift`, or
  `swift-openapi-generator`). Kotlin has no official Supabase generator: hand-written
  `@Serializable` DTOs in one package, held to the schema by shared JSON fixtures; REST backends
  generate Kotlin with `openapi-generator`. Never hand-edit generated code.
- **Drift**: CI regenerates the contract artefacts and fails on `git diff --exit-code`; both
  clients decode the same committed fixtures in their unit tests.
- **Authz**: RLS / server checks are the only real authorization. Apps ship only the
  publishable (anon) key; the `service_role` / secret key never leaves the server.
- **Parity**: same error codes, validation, analytics events and flags on both clients; an
  intended difference is written in the plan.

## References

- Supabase schema → Swift types / Kotlin DTOs, RLS, migrations, Edge Functions, REST via
  OpenAPI, fixtures, CI drift job, parity checklist: `references/shared-backend-contract.md`
