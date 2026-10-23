# Fullstack Rules (python + web)

## Components
- `components[]` in `.claude/platform-context.json`: `id`, `root` (`.`/`backend`/`frontend`), `platform`, `framework`, `commands` — run each command with `cwd` = its `root`
- A sub-task belongs to exactly ONE component; its `Files:` stay under that root
- bk-python-developer edits only the python component, bk-web-developer only the web one
- Same `root` for both: ownership by file type (`.py` → python, `.ts/.tsx/.js/.jsx` → web)

## API Contract
- Backend OpenAPI is the source of truth; FE uses types generated from it or zod schemas matching it
- Contract change = backend sub-task first, then a frontend sub-task (regenerate + adapt) in the same plan
- Never hand-edit the generated client/types; CI regenerates and fails on `git diff`
- One error envelope `{"error": {"code", "message", "details", "request_id"}}` parsed by one FE `ApiError`
- Breaking change = new version path (`/api/v2`); keep the old one until the FE has moved

## Cross-component Security
- CORS: explicit origin allowlist with `allow_credentials` — never `*`, never a reflected Origin
- Auth: HttpOnly + Secure + SameSite session cookie; unsafe methods require a CSRF token
- Prefer same-site deploy (FE and `/api` behind one origin via ingress/BFF); cross-site needs `SameSite=None; Secure` + CSRF + CORS allowlist
- No tokens in `localStorage`; no backend secrets in `NEXT_PUBLIC_*`/`VITE_*`

## Testing
- Each component runs its own lint/typecheck/test; a cross-cutting change runs both
- e2e (Playwright) runs against the real backend + frontend for critical flows
- Load the `bk-fullstack` skill for contract export, codegen, CI drift check and local dev proxy
