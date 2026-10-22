# Backend Shared Rules

## Architecture
- Layered: transport (router/controller/handler) -> service -> repository/data access
- No business logic in handlers: parse, authorize, delegate, map the response
- Dependency injection for DB sessions, clients and services; no globals holding state
- Domain errors mapped to HTTP status in one place (exception handler / middleware)

## API Contract
- REST resources, plural nouns; versioned path (`/api/v1/...`); breaking change = new version
- One error envelope: `{"error": {"code", "message", "details", "request_id"}}` — no stack traces
- List endpoints are always paginated (cursor or limit/offset with a max limit)
- Create and payment endpoints accept an `Idempotency-Key`; replay returns the stored result
- Resource IDs are UUIDs/opaque, not sequential integers (IDOR)
- Outbound HTTP: explicit timeouts, bounded retry with backoff on idempotent calls only

## Data & Migrations
- Every schema change is a migration with a working downgrade
- Expand -> migrate data -> contract; never rename/drop a live column in one step
- No long locks on big tables: create indexes concurrently, backfill in batches
- Index every column used in filters, joins and ORDER BY; avoid N+1 (eager load)
- Multi-step writes in one transaction; money as fixed-point decimal, never float

## Security
- AuthN/AuthZ server-side BEFORE any logic or DB access; deny by default
- Every lookup by ID filters by owner/tenant (`id` AND `user_id`/`tenant_id`)
- Parameterized queries / ORM only — never build SQL with string formatting
- Validate type + length + format on every input; reject negative/zero amounts
- Never trust client-sent flags for security decisions (`role`, `isInternal`, `skipOTP`)
- Secrets from env/vault only; no hardcoded keys, passwords or default credentials
- Never log password, OTP, PIN, CVV, tokens, full PAN or raw PII — mask before logging
- Outbound URLs from user input: allowlist domains, block private/loopback ranges (SSRF)
- No unsafe deserialization (pickle, `yaml.load`, `eval`, native object streams)
- JWT: verify signature, algorithm allowlist, `exp`/`iss`/`aud`; reject `alg:none`
- Rate-limit login/OTP/reset; uniform responses (no account enumeration)
- Security headers on; CORS explicit origin allowlist, never `*` with credentials
- API docs (Swagger/OpenAPI) not public in production

## Observability
- Structured JSON logs with a correlation/request id propagated across calls
- Log auth attempts, access-control failures, validation failures (without secrets)
- `/health` (liveness) and `/ready` (DB/deps) endpoints; metrics for latency/errors

## Testing
- Unit: services with fakes/mocks for repositories and external clients (>80% coverage)
- Integration: real DB (testcontainers or the target engine), transaction rolled back per test
- API tests through the app (in-process client), including 401/403/404/422 paths
- Contract tests for external APIs consumed/provided

## CI/CD
- Pipeline: lint -> typecheck -> test -> SAST/dependency audit -> build image
- Lockfile committed; dependencies from trusted registries only
- Migrations run as a separate deploy step; environment configs: dev, staging, production

## Git
- Branch: feature/TICKET-description, fix/TICKET-description
- PR checklist: tests, migration + downgrade, API contract changes, breaking changes
- Squash merge to main; tag releases: v1.2.3
