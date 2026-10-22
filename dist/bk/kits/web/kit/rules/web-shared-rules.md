# Web Shared Rules

## Architecture
- Feature-first folders; layering: UI components -> hooks -> services/api client
- Components never call `fetch` directly — go through a feature hook or service
- Server state (API data) lives in TanStack Query only — never copied into a client store
- Client state: local `useState` first, context for subtree config, Zustand for cross-feature UI state
- URL is state: filters, pagination, tabs live in search params

## API Integration
- Single typed HTTP client: base URL, auth, interceptors, error normalization to one `ApiError` type
- Validate responses with zod at the boundary; types inferred from schemas (`z.infer`)
- Every request cancellable (`AbortSignal`) with a timeout (default 15s)
- Retries only for idempotent GETs; mutations invalidate exactly the affected query keys

## Security
- Never `dangerouslySetInnerHTML` / `innerHTML` / `document.write` with user data; if HTML is unavoidable, sanitize with DOMPurify
- CSP without `unsafe-inline`/`unsafe-eval` for scripts (nonce or hash); `X-Frame-Options: DENY`, `nosniff`, HSTS
- Tokens never in localStorage/sessionStorage — HttpOnly + Secure + SameSite cookie, or memory only
- Cookie-based auth requires CSRF protection (SameSite + token or double-submit)
- No secrets in the client bundle; `NEXT_PUBLIC_` / `VITE_` only for values that are public by design
- Validate redirect targets (`returnUrl`) against an allowlist of same-origin paths — no open redirect
- Sanitize user-supplied `href`/`src`: allow `http(s):`/`mailto:` only, block `javascript:`/`data:`
- `postMessage`: always check `event.origin`; third-party scripts pinned with SRI

## UI/UX States
- Every async view handles loading / empty / error (with retry) / success
- Skeletons over spinners for content areas; reserve space to avoid layout shift
- Optimistic updates roll back on error and show the failure
- Disable submit while pending; prevent double submit

## Accessibility
- WCAG 2.1 AA; semantic HTML first (`button`, `nav`, `main`, `label`), ARIA only to fill gaps
- Every input has a visible label; errors linked via `aria-describedby`, announced with `role="alert"`
- Fully keyboard operable; visible focus ring; focus moved to dialog on open and restored on close
- Text contrast ≥ 4.5:1; never convey meaning by color alone; respect `prefers-reduced-motion`

## Performance
- Core Web Vitals budget (p75): LCP < 2.5s, INP < 200ms, CLS < 0.1
- Code-split by route; lazy-load heavy widgets (charts, editors)
- `memo`/`useMemo`/`useCallback` only when a profiler shows a cost
- Images: `next/image` or explicit `width`/`height` + `loading="lazy"` + modern formats
- Virtualize lists > ~200 rows; no request waterfalls (parallel or server-side fetch)

## Testing
- Unit: hooks, utils, schemas (>80% coverage on logic)
- Component: Testing Library by role/label, `user-event` for interaction
- Network: MSW handlers shared between tests and local dev
- E2E: Playwright for critical flows (auth, checkout, core CRUD) + axe a11y scan

## CI/CD
- Pipeline: install (frozen lockfile) -> typecheck -> lint -> test -> build -> e2e
- Environment configs: dev, staging, production; preview deploy per PR
- Semantic versioning; changelog from conventional commits

## Git
- Branch: feature/TICKET-description, fix/TICKET-description
- PR template with checklist: tests, screenshots, a11y, breaking changes
- Squash merge to main; tag releases: v1.2.3
