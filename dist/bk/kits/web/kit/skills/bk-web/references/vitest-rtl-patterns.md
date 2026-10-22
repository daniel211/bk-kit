# Vitest + Testing Library Quick Reference

## Test Types
| Type | Location | Command |
|---|---|---|
| Unit (utils, schemas, hooks) | `src/**/*.test.ts` | `npx vitest run` |
| Component | `src/**/*.test.tsx` | `npx vitest run` |
| Related to changed files | — | `npx vitest related src/x.tsx --run` |
| Coverage | `coverage/` | `npx vitest run --coverage` |
| E2E | `e2e/` | `npx playwright test` |

## Setup (vitest.config.ts + src/test/setup.ts)
```typescript
// vitest.config.ts
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    coverage: { provider: 'v8', include: ['src/**'], exclude: ['src/test/**'] },
  },
});

// src/test/setup.ts
import '@testing-library/jest-dom/vitest';
import { server } from './msw-server';
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

## Render with Providers
```tsx
// src/test/render.tsx
export function renderWithProviders(ui: ReactElement, { route = '/' } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  const user = userEvent.setup();
  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
  return { user, queryClient, ...result };
}
```
Fresh `QueryClient` per test — a shared one leaks cache between tests.
Next.js: mock `next/navigation` (`useRouter`, `useSearchParams`) with `vi.mock` instead of a router.

## MSW Handlers
```typescript
// src/test/msw-handlers.ts
export const handlers = [
  http.get('*/orders', ({ request }) => {
    const status = new URL(request.url).searchParams.get('status');
    return HttpResponse.json({ items: status ? [] : [orderFixture], nextCursor: null });
  }),
  http.post('*/auth/login', async ({ request }) => {
    const body = (await request.json()) as { email: string };
    return body.email === 'user@example.test'
      ? HttpResponse.json({ ok: true })
      : HttpResponse.json({ code: 'INVALID_CREDENTIALS' }, { status: 401 });
  }),
];
// src/test/msw-server.ts
export const server = setupServer(...handlers);
```
Per-test override:
```typescript
server.use(http.get('*/orders', () => HttpResponse.json({ message: 'boom' }, { status: 500 })));
```

## Component Test (role queries + user-event)
```tsx
describe('LoginForm', () => {
  it('shows validation errors without calling the API', async () => {
    const { user } = renderWithProviders(<LoginForm onSuccess={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText('Enter a valid email')).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toHaveAttribute('aria-invalid', 'true');
  });

  it('calls onSuccess after a valid login', async () => {
    const onSuccess = vi.fn();
    const { user } = renderWithProviders(<LoginForm onSuccess={onSuccess} />);
    await user.type(screen.getByLabelText(/email/i), 'user@example.test');
    await user.type(screen.getByLabelText(/password/i), 'test-password-1');
    await user.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
  });

  it('shows a uniform error on 401', async () => {
    const { user } = renderWithProviders(<LoginForm onSuccess={vi.fn()} />);
    await user.type(screen.getByLabelText(/email/i), 'other@example.test');
    await user.type(screen.getByLabelText(/password/i), 'test-password-1');
    await user.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/incorrect/i);
  });
});
```

## Async States
```tsx
it('renders loading, then rows', async () => {
  renderWithProviders(<OrderList />);
  expect(screen.getByTestId('order-list-skeleton')).toBeInTheDocument(); // test id OK for skeletons
  expect(await screen.findAllByRole('listitem')).toHaveLength(1);
});

it('retries after an error', async () => {
  server.use(http.get('*/orders', () => HttpResponse.json({}, { status: 500 }), { once: true }));
  const { user } = renderWithProviders(<OrderList />);
  await user.click(await screen.findByRole('button', { name: /retry/i }));
  expect(await screen.findAllByRole('listitem')).toHaveLength(1);
});
```

## Query Priority
```typescript
getByRole('button', { name: /save/i })   // 1st choice — what users and AT see
getByLabelText(/email/i)                 // form fields
getByPlaceholderText / getByText          // non-interactive content
getByTestId('x')                          // last resort
// get* throws if missing, query* returns null (assert absence), find* awaits (async)
expect(screen.queryByRole('alert')).not.toBeInTheDocument();
```

## Testing Hooks
```tsx
it('useOrders exposes the first page', async () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useOrders({}), { wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data?.pages[0].items).toHaveLength(1);
});

it('useCounter increments', () => {
  const { result } = renderHook(() => useCounter(0));
  act(() => result.current.increment());
  expect(result.current.count).toBe(1);
});
```

## Fake Timers
```typescript
beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => vi.useRealTimers());

it('debounces search input', async () => {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const onSearch = vi.fn();
  render(<SearchBox onSearch={onSearch} delayMs={300} />);
  await user.type(screen.getByRole('searchbox'), 'abc');
  expect(onSearch).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(300));
  expect(onSearch).toHaveBeenCalledWith('abc');
});
```
`userEvent.setup({ advanceTimers })` is required with fake timers or typing hangs.

## Mocking Modules
```typescript
vi.mock('@/shared/analytics', () => ({ track: vi.fn() }));
const { track } = await import('@/shared/analytics');
expect(track).toHaveBeenCalledWith('order_cancelled', { id: 'o-1' });
```
Prefer MSW for network; `vi.mock` only for non-HTTP side effects (analytics, storage, clock).

## Schema Tests
```typescript
it('rejects negative totals', () => {
  expect(orderSchema.safeParse({ ...orderFixture, total: -1 }).success).toBe(false);
});
```

## Common Pitfalls
- `act(...)` warnings: await a `find*` / `waitFor` for the state update instead of wrapping in `act`
- Snapshot tests of whole components are brittle — assert on roles and text
- `onUnhandledRequest: 'error'` catches missing handlers early
- Do not test implementation details (state values, hook call counts) — test what renders
