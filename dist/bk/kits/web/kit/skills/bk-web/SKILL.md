---
name: bk-web
description: "TypeScript/React patterns (Next.js App Router or Vite SPA) + TanStack Query, react-hook-form/zod, Vitest/Testing Library/MSW, Playwright. Platform knowledge for bk-web-developer."
user-invocable: false
---

# bk-web Platform Knowledge

Code patterns for React 18 + TypeScript (Next.js App Router or Vite SPA — match the project),
TanStack Query for server state, Vitest + Testing Library + MSW, and Playwright for e2e.
**Read the matching reference before writing data-fetching, form or test code** — it holds the
full, copy-paste examples.

## House conventions

- **Layering**: component -> feature hook (`useOrders`) -> `api/` function on the shared typed
  client. Components never call `fetch`; responses are parsed with zod at the boundary.
- **Server state**: TanStack Query with a query-key factory per feature; mutations invalidate
  exact keys. Never mirror query data into `useState` or a store.
- **Forms**: `react-hook-form` + `zodResolver`; the zod schema is the single source of the type.
- **Errors**: normalized to one `ApiError`; views render loading / empty / error-with-retry;
  an error boundary per route segment.
- **Next.js**: Server Components by default; `'use client'` only on interactive leaves; secrets
  stay server-side (no `NEXT_PUBLIC_` for them).
- **Tests**: `renderWithProviders` (fresh `QueryClient`, `retry: false`), `user-event`, role
  queries, MSW at the HTTP boundary; Playwright with page objects + `getByRole` + axe scan.

## Framework

Read `framework` from `.claude/platform-context.json` (missing = `generic`), then open only
`frameworks[framework].references` plus the shared references below — skip the other framework's.
Test command comes from `commands.test` (Vitest or Jest).

| `framework` | Reference |
|---|---|
| `next` | `references/nextjs-patterns.md` — App Router, RSC/client boundary, caching, Server Actions, middleware |
| `vite` | `references/vite-spa-patterns.md` — data router, lazy routes, `VITE_*` env, dev proxy, cookie auth |
| `generic` | shared references only; follow the project's existing structure |

## Shared References

- Feature folder, typed client, query hooks, forms, error boundary:
  `references/react-patterns.md`
- Providers wrapper, user-event, MSW, hook tests, fake timers: `references/vitest-rtl-patterns.md`
- Page objects, auth state reuse, network mocking, axe, visual snapshots:
  `references/playwright-e2e-patterns.md`
