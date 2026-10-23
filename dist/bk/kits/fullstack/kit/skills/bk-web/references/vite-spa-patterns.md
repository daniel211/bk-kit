# Vite SPA Patterns Quick Reference

## Layout
```
src/
├── main.tsx                  # createRoot, providers, RouterProvider
├── app/
│   ├── router.tsx            # route tree (data router)
│   ├── providers.tsx         # QueryClientProvider, theme, i18n
│   └── query-client.ts
├── routes/                   # route modules: orders.tsx, order-detail.tsx, root-layout.tsx
├── features/<name>/          # components/, hooks/, api/, schemas.ts
├── shared/api/http-client.ts # one typed client, cookie auth, CSRF header
└── env.ts                    # parsed import.meta.env
vite.config.ts
```
Everything in the bundle is public. The SPA is UI only — authn and authz live in the API.

## Env (public by definition)
```ts
// src/env.ts
import { z } from 'zod';

const Env = z.object({
  VITE_API_BASE_URL: z.string().default('/api'),        // relative — same origin via proxy / ingress
  VITE_SENTRY_DSN: z.string().optional(),               // public DSN is fine; no auth tokens
});
export const env = Env.parse(import.meta.env);
```
- Only `VITE_*` vars reach `import.meta.env`, inlined at build time and readable by anyone.
  Never put API keys, client secrets or signing keys there (also not in `define`).
- Do not widen `envPrefix` to `''` — that exposes every env var.
- Per-environment config: build once per env, or fetch `/config.json` at startup.

## Dev Proxy (dev only)
```ts
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:8000', changeOrigin: true },  // dev only, not shipped
    },
  },
  build: { sourcemap: false },                           // or 'hidden' + upload to error tracker
});
```
`server.proxy` does not exist in the production build — prod routes `/api` through the ingress /
reverse proxy to keep same-origin cookies. Never ship a dev server (`vite`, `vite preview`) as prod.

## Auth: HttpOnly Cookie via API / BFF
```ts
// src/shared/api/http-client.ts
import type { z } from 'zod';
import { env } from '@/env';

export class ApiError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

function csrfToken(): string {
  return document.cookie.match(/(?:^|; )csrf_token=([^;]+)/)?.[1] ?? '';
}

export async function request<T>(path: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${env.VITE_API_BASE_URL}${path}`, {
    ...init,
    credentials: 'include',                              // HttpOnly session cookie set by the API/BFF
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken(), ...init.headers },
  });
  if (res.status === 401) { window.location.assign('/login'); throw new ApiError(401, 'unauthorized'); }
  if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => ({})))?.error?.code ?? 'unknown');
  return schema.parse(await res.json());                  // validate at the boundary
}
```
- No access/refresh token in `localStorage` / `sessionStorage` — an XSS reads them. The BFF holds
  OIDC tokens server-side; the browser gets an opaque `HttpOnly; Secure; SameSite` session cookie.
- `path` is a fixed app path, never a user-supplied absolute URL.

## Data Router + Lazy Routes
```tsx
// src/app/router.tsx (React Router 6.4+ / 7)
import { createBrowserRouter, redirect } from 'react-router-dom';
import { queryClient } from './query-client';
import { meQuery } from '@/features/auth/api/me-query';

export const router = createBrowserRouter([
  {
    path: '/',
    lazy: () => import('@/routes/root-layout'),          // code-split per route
    errorElement: <RouteError />,
    children: [
      { index: true, lazy: () => import('@/routes/home') },
      {
        path: 'orders',
        loader: async () => {
          const me = await queryClient.ensureQueryData(meQuery).catch(() => null);
          if (!me) throw redirect('/login');            // UX gate only — API enforces authz
          return null;
        },
        children: [
          { index: true, lazy: () => import('@/routes/orders') },
          { path: ':orderId', lazy: () => import('@/routes/order-detail') },
        ],
      },
    ],
  },
]);
```
A `lazy` module exports `Component` (and optional `loader`, `ErrorBoundary`). TanStack Router:
same shape with `createRoute`, `beforeLoad` for the gate, `.lazy.tsx` files for splitting.
Loaders prefetch via `queryClient.ensureQueryData` so the component's `useQuery` hits the cache.

## TanStack Query Setup
```ts
// src/app/query-client.ts
import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/shared/api/http-client';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
      refetchOnWindowFocus: false,
    },
  },
});
```
- On logout: call the API logout (it clears the cookie + OIDC RP-logout), then `queryClient.clear()`.
- Query-key factories and mutation invalidation: see `react-patterns.md`.

## Redirect Params
```ts
const next = new URLSearchParams(location.search).get('next') ?? '/';
navigate(next.startsWith('/') && !next.startsWith('//') ? next : '/');   // same-origin only
```

## Build / Preview
- `npm run build` (`tsc -b && vite build`) -> static `dist/`; serve with nginx/CDN, SPA fallback to
  `index.html`, long cache for hashed assets, `no-cache` for `index.html`.
- Security headers (CSP, HSTS, `X-Frame-Options: DENY`, `nosniff`) come from the web server,
  not from Vite.
- `vite preview` is a local smoke test of `dist/`, not a production server.
- Bundle check: `npx vite-bundle-visualizer`; heavy libs behind `lazy()` / dynamic `import()`.

## Testing
- Vitest shares `vite.config.ts` (`test: { environment: 'jsdom', setupFiles: ['src/test/setup.ts'] }`);
  if the project uses Jest, take the command from platform-context `commands.test`.
- Route tests: `createMemoryRouter(routes, { initialEntries: ['/orders/1'] })` +
  `<RouterProvider>` inside `renderWithProviders`; MSW for the API (`vitest-rtl-patterns.md`).
- Assert the 401 path redirects to `/login` and that no token is written to storage.
- E2E: Playwright against `vite build && vite preview` with the API mocked or a test backend
  (`playwright-e2e-patterns.md`).
