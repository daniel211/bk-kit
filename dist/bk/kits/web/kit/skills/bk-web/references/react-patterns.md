# React Patterns Quick Reference

## Feature Folder
```
src/features/orders/
├── api/orders-api.ts         # requests + zod schemas
├── hooks/use-orders.ts       # query keys + query/mutation hooks
├── components/
│   ├── order-list.tsx
│   └── order-list.test.tsx
└── index.ts                  # public surface of the feature
```
Other features import from `features/orders` (index), never from its internals.

## Typed API Client (shared/api/http-client.ts)
```typescript
import { z } from 'zod';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

const BASE_URL = import.meta.env.VITE_API_URL; // public value only — never a secret

export async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const { timeoutMs = 15_000, signal, ...rest } = init;
  const timeout = AbortSignal.timeout(timeoutMs);
  const res = await fetch(`${BASE_URL}${path}`, {
    ...rest,
    credentials: 'include', // HttpOnly session cookie; no token in JS storage
    headers: { 'Content-Type': 'application/json', ...rest.headers },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.code ?? 'UNKNOWN', body.message ?? res.statusText);
  }
  return schema.parse(await res.json()); // reject unexpected shapes at the boundary
}
```
For cookie auth add the CSRF header the backend expects (e.g. `X-CSRF-Token` read from a
non-HttpOnly CSRF cookie) on every non-GET request.

## Feature API + Schemas
```typescript
export const orderSchema = z.object({
  id: z.string().uuid(),
  total: z.number().nonnegative(),
  status: z.enum(['pending', 'paid', 'shipped']),
});
export type Order = z.infer<typeof orderSchema>;

const pageSchema = z.object({ items: z.array(orderSchema), nextCursor: z.string().nullable() });

export const ordersApi = {
  list: (params: { cursor?: string; status?: string }, signal?: AbortSignal) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]);
    return request(`/orders?${qs}`, pageSchema, { signal });
  },
  cancel: (id: string) =>
    request(`/orders/${encodeURIComponent(id)}/cancel`, orderSchema, { method: 'POST' }),
};
```

## TanStack Query Hooks with Key Factory
```typescript
export const orderKeys = {
  all: ['orders'] as const,
  lists: () => [...orderKeys.all, 'list'] as const,
  list: (filters: { status?: string }) => [...orderKeys.lists(), filters] as const,
  detail: (id: string) => [...orderKeys.all, 'detail', id] as const,
};

export function useOrders(filters: { status?: string }) {
  return useInfiniteQuery({
    queryKey: orderKeys.list(filters),
    queryFn: ({ pageParam, signal }) => ordersApi.list({ ...filters, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 30_000,
  });
}

export function useCancelOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ordersApi.cancel,
    onSuccess: () => qc.invalidateQueries({ queryKey: orderKeys.lists() }),
  });
}
```
Optimistic update: `onMutate` snapshot via `getQueryData` + `setQueryData`, `onError` restore
the snapshot, `onSettled` invalidate.

## Async View States
```tsx
export function OrderList({ status }: { status?: string }) {
  const { data, isPending, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useOrders({ status });

  if (isPending) return <OrderListSkeleton />;
  if (isError) return <ErrorState message="Could not load orders" onRetry={() => refetch()} />;
  const orders = data.pages.flatMap((p) => p.items);
  if (orders.length === 0) return <EmptyState title="No orders yet" />;

  return (
    <>
      <ul aria-label="Orders">
        {orders.map((o) => <OrderRow key={o.id} order={o} />)}
      </ul>
      {hasNextPage && (
        <button type="button" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
          {isFetchingNextPage ? 'Loading…' : 'Load more'}
        </button>
      )}
    </>
  );
}
```

## Form with react-hook-form + zod
```tsx
const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email'),
  password: z.string().min(8, 'At least 8 characters'),
});
type LoginValues = z.infer<typeof loginSchema>;

export function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const login = useLogin();
  const { register, handleSubmit, formState: { errors, isSubmitting } } =
    useForm<LoginValues>({ resolver: zodResolver(loginSchema) });

  const onSubmit = handleSubmit((values) => login.mutateAsync(values).then(onSuccess));

  return (
    <form onSubmit={onSubmit} noValidate>
      <label htmlFor="email">Email</label>
      <input id="email" type="email" autoComplete="username"
        aria-invalid={!!errors.email} aria-describedby="email-error" {...register('email')} />
      {errors.email && <p id="email-error" role="alert">{errors.email.message}</p>}

      <label htmlFor="password">Password</label>
      <input id="password" type="password" autoComplete="current-password"
        aria-invalid={!!errors.password} aria-describedby="password-error" {...register('password')} />
      {errors.password && <p id="password-error" role="alert">{errors.password.message}</p>}

      {login.isError && <p role="alert">Email or password is incorrect</p>}
      <button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Signing in…' : 'Sign in'}</button>
    </form>
  );
}
```
Uniform failure message (no "user does not exist") to avoid account enumeration.

## Safe Links and Redirects
```typescript
export function safeHref(url: string): string | undefined {
  try {
    const u = new URL(url, window.location.origin);
    return ['https:', 'http:', 'mailto:'].includes(u.protocol) ? u.href : undefined;
  } catch { return undefined; }
}

export function safeReturnTo(raw: string | null): string {
  // same-origin relative path only: "/x" but not "//evil.com" or "/\evil.com"
  return raw && /^\/(?![\/\\])/.test(raw) ? raw : '/';
}
```

## Error Boundary
```tsx
// react-error-boundary — one per route segment, resets with the query cache
<QueryErrorResetBoundary>
  {({ reset }) => (
    <ErrorBoundary onReset={reset} fallbackRender={({ resetErrorBoundary }) => (
      <ErrorState message="Something went wrong" onRetry={resetErrorBoundary} />
    )}>
      <OrdersPage />
    </ErrorBoundary>
  )}
</QueryErrorResetBoundary>
```
Next.js App Router: `error.tsx` (must be `'use client'`) + `loading.tsx` per segment.

## Next.js Server vs Client Components
| Concern | Server Component (default) | Client Component (`'use client'`) |
|---|---|---|
| Data fetch | `await` in component, secrets OK (server-only) | TanStack Query via hooks |
| State / effects / events | Not allowed | Allowed |
| Bundle | Zero JS shipped | Shipped to browser |
| Env vars | Any `process.env.X` | Only `NEXT_PUBLIC_*` (public values) |

- Keep `'use client'` at the leaf (button, form), pass server data down as props
- Mark server-only modules with `import 'server-only'` so they cannot leak into the bundle
- Server Actions: validate input with zod and re-check authz inside the action — never trust the caller
- Prefetch on the server + `HydrationBoundary` to avoid client waterfalls
- Hydration: no `Date.now()`, `Math.random()`, `window` reads during render — move to `useEffect`

## Vite SPA Notes
- Routes lazy-loaded: `const Orders = lazy(() => import('./features/orders/orders-page'))`
- `VITE_*` env vars are inlined into the bundle — public values only
- Security headers / CSP set at the host (CDN, nginx), not in the app
