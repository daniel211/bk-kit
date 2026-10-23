---
name: bk-fullstack
description: "Python backend + web frontend in one repo: OpenAPI export, generated FE types/client, contract drift check, CORS/cookie/CSRF across both, dev proxy. Platform knowledge for bk-python-developer and bk-web-developer in fullstack projects."
user-invocable: false
---

# bk-fullstack Platform Knowledge

Glue between the python component (FastAPI or Django/DRF) and the web component (Next.js or
Vite) of one repo. Component patterns stay in `bk-python` and `bk-web`; this skill covers only
what crosses the boundary. **Read `references/api-contract.md` before changing an endpoint the
FE calls, the generated client, CORS/cookie/CSRF settings, or the dev proxy.**

## Components

Read `components[]` from `.claude/platform-context.json`: each has `id`, `root`, `platform`,
`framework`, `commands`. Run a component's commands with `cwd` = its `root`. Edit only files
under your own component's root; if a change needs the other side, report it as a follow-up
sub-task instead of editing it.

## House conventions

- **Contract**: the backend's OpenAPI document is the source of truth, committed at a fixed
  path (e.g. `backend/openapi.json`). The FE generates `schema.d.ts` from it and never
  hand-edits generated files.
- **Order**: contract change = backend sub-task (endpoint + exported schema + tests) first,
  then frontend sub-task (regenerate + adapt + tests).
- **Drift**: CI re-exports the schema and regenerates the client; `git diff --exit-code` fails
  the build on any difference.
- **Errors**: one envelope `{"error": {"code", "message", "details", "request_id"}}`; the FE
  maps it to one `ApiError` and branches on `code`, never on `message`.
- **Auth**: HttpOnly session cookie + CSRF header, same-site behind one origin when possible;
  CORS is an explicit allowlist with credentials.
- **Local dev**: FE calls a relative `/api`; Vite `server.proxy` or Next `rewrites` forward it to
  the backend, so cookies stay same-origin and CORS is not needed in dev.

## References

- OpenAPI export (FastAPI, drf-spectacular), `openapi-typescript` + `openapi-fetch` / orval, CI
  drift check, contract tests, versioning, error envelope, auth flow, dev proxy, CORS:
  `references/api-contract.md`
