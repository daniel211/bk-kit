# Next.js App Router Patterns Quick Reference

## Layout
```
src/app/
├── layout.tsx                 # root layout: <html>, providers (client wrapper), metadata
├── (marketing)/page.tsx       # route group — no URL segment
├── (app)/
│   ├── layout.tsx             # authenticated shell; still re-check auth in data + actions
│   ├── orders/
│   │   ├── page.tsx           # Server Component: fetch + render
│   │   ├── loading.tsx        # Suspense fallback for the segment
│   │   ├── error.tsx          # 'use client' error boundary for the segment
│   │   ├── [orderId]/page.tsx
│   │   └── actions.ts         # 'use server' — Server Actions
│   └── not-found.tsx
└── api/webhooks/route.ts      # route handler (external callers only)
src/features/orders/           # components/, server/ (queries, 'server-only'), schemas.ts
src/middleware.ts
```
Server Components by default. `'use client'` only on the interactive leaf (form, toggle, chart) —
never on a page or layout just to use one hook. Pass serializable props only; never pass secrets,
full DB rows or tokens across the boundary.

## Server-Only Data Access
```ts
// src/features/orders/server/order-queries.ts
import 'server-only';                                   // build fails if a client module imports this
import { cache } from 'react';
import { getSession } from '@/shared/auth/session';     // reads HttpOnly session cookie server-side
import { db } from '@/shared/db';

export const getOrder = cache(async (orderId: string) => {
  const session = await getSession();
  if (!session) return null;
  // ownership in the query itself — IDOR guard
  return db.order.findFirst({
    where: { id: orderId, userId: session.userId },
    select: { id: true, status: true, total: true, createdAt: true },  // DTO, not the full row
  });
});
```

## Page (Server Component) + Metadata
```tsx
// src/app/(app)/orders/[orderId]/page.tsx
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getOrder } from '@/features/orders/server/order-queries';
import { CancelOrderButton } from '@/features/orders/components/cancel-order-button';

type Props = { params: Promise<{ orderId: string }> };   // Next 15: params is async

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const order = await getOrder((await params).orderId);   // deduped by cache()
  return { title: order ? `Order ${order.id}` : 'Order' };
}

export default async function OrderPage({ params }: Props) {
  const order = await getOrder((await params).orderId);
  if (!order) notFound();                                 // not owned == not found
  return (
    <main>
      <h1>Order {order.id}</h1>
      <p>Status: {order.status}</p>
      <CancelOrderButton orderId={order.id} />
    </main>
  );
}
```

## Data Fetching + Caching
```ts
// external API, shared data: cache with tag + time-based revalidation
const res = await fetch(`${process.env.CATALOG_API_URL}/products`, {
  next: { revalidate: 300, tags: ['products'] },
});
// per-user data: never shared-cached
const res2 = await fetch(`${process.env.ORDERS_API_URL}/me/orders`, {
  cache: 'no-store',
  headers: { Authorization: `Bearer ${await getAccessToken()}` },   // server-side only
});
```
- Default `fetch` caching changed in Next 15 (uncached by default) — set `cache` / `revalidate`
  explicitly, do not rely on the version default.
- Reading `cookies()` / `headers()` makes the route dynamic; user-specific pages must be dynamic.
- Never put per-user data behind `unstable_cache` / `revalidate` keyed without the user id.
- Run independent fetches in parallel (`Promise.all`); stream slow parts behind `<Suspense>`.
- After a mutation: `revalidateTag('orders')` / `revalidatePath('/orders')`.

## Server Actions = public POST endpoints
```ts
// src/app/(app)/orders/actions.ts
'use server';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { getSession } from '@/shared/auth/session';
import { db } from '@/shared/db';

const CancelOrder = z.object({ orderId: z.string().uuid() });

export type ActionResult = { ok: true } | { ok: false; error: 'invalid' | 'not_found' | 'unauthorized' };

export async function cancelOrder(input: unknown): Promise<ActionResult> {
  const session = await getSession();                    // authn inside EVERY action
  if (!session) return { ok: false, error: 'unauthorized' };
  const parsed = CancelOrder.safeParse(input);           // never trust the action's arguments
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { count } = await db.order.updateMany({          // authz: owner filter in the write
    where: { id: parsed.data.orderId, userId: session.userId, status: 'pending' },
    data: { status: 'cancelled' },
  });
  if (count === 0) return { ok: false, error: 'not_found' };
  revalidatePath('/orders');
  return { ok: true };
}
```
Any exported function in a `'use server'` file is callable by anyone who can reach the app, with
any arguments — the page that renders the button is not a guard. Return typed results, not thrown
errors with internal detail. Next checks `Origin` for actions; keep `serverActions.allowedOrigins`
narrow.

## Client Leaf Calling an Action
```tsx
'use client';
import { useTransition } from 'react';
import { cancelOrder } from '@/app/(app)/orders/actions';

export function CancelOrderButton({ orderId }: { orderId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button type="button" disabled={pending}
      onClick={() => startTransition(async () => { await cancelOrder({ orderId }); })}>
      {pending ? 'Cancelling…' : 'Cancel order'}
    </button>
  );
}
```
Forms: `useActionState(action, initial)` + `<form action={formAction}>`; validate again with zod
in the action even if the form uses `zodResolver`.

## Route Handlers
```ts
// src/app/api/webhooks/payment/route.ts — for external callers (webhooks, mobile clients)
import { NextResponse, type NextRequest } from 'next/server';
import { verifyWebhookSignature } from '@/shared/payments/verify';
import { PaymentEvent, handlePaymentEvent } from '@/features/payments/server/payment-events';

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!verifyWebhookSignature(raw, req.headers.get('x-signature'))) {   // HMAC, constant-time
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  }
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: 'invalid' }, { status: 400 }); }
  const event = PaymentEvent.safeParse(body);
  if (!event.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  await handlePaymentEvent(event.data);                   // idempotent on event.id
  return NextResponse.json({ ok: true });
}
```
Same rules as actions: authn + zod + owner filter in every handler. Prefer Server Components /
actions for the app's own UI; route handlers for third parties.

## Middleware (coarse gate only)
```ts
// src/middleware.ts
import { NextResponse, type NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  if (!req.cookies.has('session')) {
    const url = new URL('/login', req.url);
    url.searchParams.set('next', req.nextUrl.pathname);  // same-origin path only; validate on use
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|login|api/webhooks).*)'] };
```
Middleware checks cookie presence, not permissions, and a matcher gap silently skips it — the real
authz stays in the data layer, every Server Action and every route handler (CVE-2025-29927 showed
middleware can be bypassed). Security headers (CSP with nonce, HSTS, `X-Frame-Options`) set here or
in `next.config` `headers()`.

## Env
- Only `NEXT_PUBLIC_*` is inlined into the client bundle — at **build** time. Never put keys,
  secrets or internal URLs there.
- Server secrets (`DATABASE_URL`, `SSO_CLIENT_SECRET`) read only in `'server-only'` modules.
- Validate env once at startup with zod (`src/shared/env.server.ts`); fail fast on missing values.
- `poweredByHeader: false`, `productionBrowserSourceMaps: false` in `next.config`.

## error.tsx / loading.tsx / not-found.tsx
```tsx
'use client';                                            // error boundaries must be client
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert">
      <p>Something went wrong.</p>                       {/* never render error.message from server */}
      <button type="button" onClick={reset}>Try again</button>
    </div>
  );
}
```
`loading.tsx` per slow segment; `global-error.tsx` for the root layout; `notFound()` for missing
or not-owned resources.

## Testing
- Client components, hooks, zod schemas: Vitest (or Jest — use `commands.test`) + Testing Library.
- Async Server Components are not supported by RTL render — test their data functions directly
  (mock `getSession` / the DB) and cover the page with Playwright.
- Server Actions: call the function in a unit test with a mocked session — assert unauthorized,
  invalid input and other-user ids all fail.
- Playwright against `next build && next start` (not `next dev`) for route, middleware and
  redirect behavior.
