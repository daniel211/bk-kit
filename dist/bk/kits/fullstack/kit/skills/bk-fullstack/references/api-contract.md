# API Contract Quick Reference (python BE + web FE)

Paths assume `backend/` + `frontend/` components; with both at `.` drop the prefixes. The
backend exports `openapi.json`; the frontend generates from it. Both files are committed.

## 1. Export OpenAPI

### FastAPI
```python
# backend/scripts/export_openapi.py — run in CI and after every endpoint change
import json, sys
from pathlib import Path
from app.main import app

Path(sys.argv[1]).write_text(json.dumps(app.openapi(), indent=2, sort_keys=True) + "\n")
```
```python
# app/main.py — stable operationIds (codegen names) and no public docs in prod
app = FastAPI(
    title="Shop API", version="1.4.0",
    generate_unique_id_function=lambda r: f"{r.tags[0]}_{r.name}" if r.tags else r.name,
    docs_url=None if settings.is_prod else "/docs", redoc_url=None,
    openapi_url=None if settings.is_prod else "/openapi.json",
)
```
`uv run python scripts/export_openapi.py openapi.json` (cwd `backend`). Every router has `tags`
and every route a `response_model` — an untyped response becomes `unknown` on the FE.

### Django + DRF (drf-spectacular)
```python
REST_FRAMEWORK = {"DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema", ...}
SPECTACULAR_SETTINGS = {
    "TITLE": "Shop API", "VERSION": "1.4.0",
    "COMPONENT_SPLIT_REQUEST": True,   # separate FooRequest / Foo: read-only fields not required on input
    "SERVE_INCLUDE_SCHEMA": False,
    "SERVE_PERMISSIONS": ["rest_framework.permissions.IsAdminUser"],  # schema view not public
}
```
`python manage.py spectacular --file openapi.yaml --validate --fail-on-warn` (cwd `backend`).
Annotate custom views with `@extend_schema(request=..., responses={200: OrderSerializer, 404: ErrorEnvelopeSerializer})`.

## 2. Generate FE types + client

### openapi-typescript + openapi-fetch (types only, smallest runtime)
```jsonc
// frontend/package.json
"scripts": { "api:gen": "openapi-typescript ../backend/openapi.json -o src/shared/api/schema.d.ts" }
```
```ts
// src/shared/api/client.ts — the only place that builds the client
import createClient, { type Middleware } from 'openapi-fetch';
import type { paths } from './schema';

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const readCookie = (n: string) => document.cookie.match(new RegExp(`(?:^|; )${n}=([^;]+)`))?.[1] ?? '';

const csrf: Middleware = {
  onRequest({ request }) {
    if (UNSAFE.has(request.method)) request.headers.set('X-CSRF-Token', readCookie('csrf_token'));
    return request;
  },
};

export const api = createClient<paths>({ baseUrl: '', credentials: 'include' }); // paths start with /api/v1, same origin
api.use(csrf);
```
```ts
// features/orders/api/get-order.ts
export async function getOrder(id: string, signal?: AbortSignal) {
  const { data, error, response } = await api.GET('/api/v1/orders/{order_id}', {
    params: { path: { order_id: id } }, signal,
  });
  if (error) throw toApiError(response.status, error);   // see §6
  return data;                                           // typed as components['schemas']['OrderOut']
}
```
Runtime validation where data drives security/money decisions: a zod schema checked against the
generated type, so contract drift fails `tsc`:
```ts
import type { components } from '@/shared/api/schema';
const Order = z.object({ id: z.string().uuid(), total: z.string(), status: z.enum(['pending', 'paid']) });
const parsed: components['schemas']['OrderOut'] = Order.parse(data);  // type error if the BE shape moved
```

### orval (generated TanStack Query hooks + zod)
```ts
// frontend/orval.config.ts
import { defineConfig } from 'orval';
export default defineConfig({
  api: {
    input: '../backend/openapi.json',
    output: { target: 'src/shared/api/generated/endpoints.ts', client: 'react-query', mode: 'tags-split',
              override: { mutator: { path: 'src/shared/api/http-client.ts', name: 'request' } } },
  },
  apiZod: { input: '../backend/openapi.json',
            output: { target: 'src/shared/api/generated/schemas.zod.ts', client: 'zod' } },
});
```
The mutator is the shared client (cookies, CSRF header, envelope -> `ApiError`). Pick one
generator per repo. Generated folders are read-only: add them to `.eslintignore`/`.prettierignore`
and mark `linguist-generated` in `.gitattributes`.

## 3. CI drift check
```yaml
# .github/workflows/contract.yml (pin actions by commit SHA in real pipelines)
jobs:
  contract:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }                     # origin/main for the breaking-change diff
      - uses: astral-sh/setup-uv@v5
      - run: uv sync --frozen && uv run python scripts/export_openapi.py openapi.json
        working-directory: backend
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm, cache-dependency-path: frontend/package-lock.json }
      - run: npm ci && npm run api:gen && npx tsc --noEmit
        working-directory: frontend
      - run: git diff --exit-code -- backend/openapi.json frontend/src/shared/api/
      - run: |  # breaking change against main => needs a new version path
          git show origin/main:backend/openapi.json > "$RUNNER_TEMP/base.json"
          oasdiff breaking "$RUNNER_TEMP/base.json" backend/openapi.json --fail-on ERR
```
A red diff means: someone changed the BE without re-exporting, or hand-edited generated FE code.

## 4. Contract tests
```python
# backend/tests/test_openapi_contract.py — committed schema == live schema
def test_committed_openapi_is_current() -> None:
    committed = json.loads(Path("openapi.json").read_text())
    assert committed == app.openapi(), "run scripts/export_openapi.py and commit"
```
- Property-based: `schemathesis run openapi.json --url http://localhost:8000` against a test
  server with seeded users (auth via test cookie fixture) — catches 500s and responses that
  violate the schema.
- FE: MSW handlers typed with `components['schemas'][...]`, so a schema change breaks the build,
  not production. Keep one handler per endpoint, shared by Vitest and local dev.

## 5. Versioning and deprecation
- Prefix `/api/v1`. Non-breaking: new endpoint, new optional input field, new response field.
  Breaking: remove/rename field, change type or enum, make input required, change status codes.
- Breaking -> mount `/api/v2` router beside v1; FE moves in a later sub-task; then delete v1.
- Mark the old route `@router.get(..., deprecated=True)` (DRF: `@extend_schema(deprecated=True)`)
  and send `Deprecation: true` + `Sunset: <date>` headers. openapi-typescript emits `@deprecated`
  JSDoc; `@typescript-eslint/no-deprecated` flags remaining FE call sites.
- FE never reads undocumented fields; BE never removes a field the FE still reads.

## 6. One error envelope
```python
class ErrorBody(BaseModel):
    code: str
    message: str
    details: list[dict[str, str]] = []
    request_id: str

class ErrorEnvelope(BaseModel):
    error: ErrorBody

router = APIRouter(prefix="/api/v1/orders", tags=["orders"],
                   responses={404: {"model": ErrorEnvelope}, 422: {"model": ErrorEnvelope}})

@app.exception_handler(RequestValidationError)
async def on_validation(request: Request, exc: RequestValidationError) -> JSONResponse:
    details = [{"field": ".".join(map(str, e["loc"][1:])), "code": e["type"]} for e in exc.errors()]
    return JSONResponse(status_code=422, content={"error": {"code": "validation_error",
        "message": "Invalid request", "details": details, "request_id": request.state.request_id}})
```
No input values echoed in `details` (they may hold PII or secrets). DRF: the same shape from a
custom `REST_FRAMEWORK["EXCEPTION_HANDLER"]`.
```ts
const ErrorEnvelope = z.object({ error: z.object({
  code: z.string(), message: z.string(), details: z.array(z.record(z.string(), z.string())).default([]), request_id: z.string(),
}) });
// ApiError(status, code, requestId?) — the shared client's single error type
export function toApiError(status: number, body: unknown): ApiError {
  const parsed = ErrorEnvelope.safeParse(body);
  return new ApiError(status, parsed.success ? parsed.data.error.code : 'unknown',
                      parsed.success ? parsed.data.error.request_id : undefined);
}
```
UI branches on `code` (i18n message keys), never on `message`; show `request_id` for support.

## 7. Auth across BE and FE
Login goes through the SSO/OIDC provider handled by the backend (BFF): tokens stay server-side,
the browser only holds an opaque session cookie.
```python
# after the OIDC callback validated state/nonce/PKCE: new session id (no fixation)
response.set_cookie("session", new_session_id, httponly=True, secure=True, samesite="lax",
                    max_age=settings.session_ttl, path="/")
response.set_cookie("csrf_token", secrets.token_urlsafe(32), httponly=False, secure=True,
                    samesite="lax", path="/")           # readable by JS; store it in the session to bind it

class CSRFMiddleware(BaseHTTPMiddleware):             # double submit, unsafe methods only
    async def dispatch(self, request: Request, call_next):
        if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
            cookie, header = request.cookies.get("csrf_token", ""), request.headers.get("x-csrf-token", "")
            if not cookie or not secrets.compare_digest(cookie, header):
                return JSONResponse(status_code=403, content={"error": {"code": "csrf_failed",
                    "message": "CSRF check failed", "details": [], "request_id": request.state.request_id}})
        return await call_next(request)
```
Django: keep `CsrfViewMiddleware`; `SESSION_COOKIE_HTTPONLY = True`, `SESSION_COOKIE_SECURE =
CSRF_COOKIE_SECURE = True`, `SESSION_COOKIE_SAMESITE = "Lax"`; an `@ensure_csrf_cookie` GET
endpoint primes `csrftoken`, the FE sends it as `X-CSRFToken`; `django.contrib.auth.login()`
rotates the session key. Logout: invalidate the server session + OIDC RP-initiated logout.

## 8. Local dev: one origin via proxy
```ts
// Vite — vite.config.ts (dev only; prod routes /api through the ingress)
server: { proxy: { '/api': { target: 'http://localhost:8000', changeOrigin: true } } },
```
```js
// Next — next.config.mjs (also proxies in prod; API_INTERNAL_URL is server-only)
const API = process.env.API_INTERNAL_URL ?? 'http://localhost:8000';
export default { async rewrites() { return [{ source: '/api/:path*', destination: `${API}/api/:path*` }]; } };
```
Server Components calling the API directly use `API_INTERNAL_URL` and forward the incoming
`cookie` header — never a `NEXT_PUBLIC_` URL with a service token.

## 9. CORS (only when FE and API are on different origins)
```python
# FastAPI
LOCAL_DEV = re.compile(r"http://(localhost|127\.0\.0\.1):\d+")

class Settings(BaseSettings):
    cors_origins: list[str] = []                      # e.g. ["https://app.example.com"]

    @field_validator("cors_origins")
    @classmethod
    def no_wildcard(cls, v: list[str]) -> list[str]:
        if any(o == "*" or not (o.startswith("https://") or LOCAL_DEV.fullmatch(o)) for o in v):
            raise ValueError("CORS origins must be explicit https origins")
        return v

app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=True,
                   allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
                   allow_headers=["Content-Type", "X-CSRF-Token"], max_age=600)
```
```python
# Django — django-cors-headers; CorsMiddleware placed above CommonMiddleware
CORS_ALLOWED_ORIGINS = env.list("CORS_ALLOWED_ORIGINS", default=[])
CORS_ALLOW_CREDENTIALS = True
CSRF_TRUSTED_ORIGINS = CORS_ALLOWED_ORIGINS
# never CORS_ALLOW_ALL_ORIGINS = True, never a broad CORS_ALLOWED_ORIGIN_REGEXES
```
Cross-site (different registrable domain) also needs `SameSite=None; Secure` cookies — prefer
moving FE and API under one site instead.

## 10. e2e against both
```ts
// frontend/playwright.config.ts
webServer: [
  { command: 'uv run uvicorn app.main:app --port 8000', cwd: '../backend',
    url: 'http://localhost:8000/health', reuseExistingServer: !process.env.CI },
  { command: 'npm run dev', url: 'http://localhost:5173', reuseExistingServer: !process.env.CI },
],
use: { baseURL: 'http://localhost:5173' },
```
Seed test users through a test-only fixture or CLI, never a prod endpoint.
