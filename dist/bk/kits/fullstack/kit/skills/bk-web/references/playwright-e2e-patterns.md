# Playwright E2E Quick Reference

## Config (playwright.config.ts)
```typescript
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000', trace: 'on-first-retry' },
  webServer: { command: 'npm run dev', url: 'http://localhost:3000', reuseExistingServer: !process.env.CI },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    { name: 'chromium', use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/user.json' },
      dependencies: ['setup'] },
  ],
});
```
Add `e2e/.auth/` to `.gitignore` — it holds session cookies.

## Page Object
```typescript
// e2e/pages/login-page.ts
export class LoginPage {
  constructor(private readonly page: Page) {}
  readonly email = () => this.page.getByLabel('Email');
  readonly password = () => this.page.getByLabel('Password');
  readonly submit = () => this.page.getByRole('button', { name: 'Sign in' });

  async goto() { await this.page.goto('/login'); }
  async login(email: string, password: string) {
    await this.email().fill(email);
    await this.password().fill(password);
    await this.submit().click();
  }
}
```

## Locators
```typescript
page.getByRole('button', { name: 'Save' })   // 1st choice
page.getByLabel('Email')                     // form fields
page.getByText('No orders yet')
page.getByTestId('chart')                    // last resort
page.getByRole('row').filter({ hasText: 'Order #42' }).getByRole('button', { name: 'Cancel' })
await expect(page.getByRole('alert')).toHaveText(/incorrect/i); // auto-waiting assertion
```
Never `page.waitForTimeout` — rely on web-first assertions.

## Auth State Reuse
```typescript
// e2e/auth.setup.ts — logs in once, saves cookies for all tests
setup('authenticate', async ({ page }) => {
  const login = new LoginPage(page);
  await login.goto();
  await login.login(process.env.E2E_USER_EMAIL!, process.env.E2E_USER_PASSWORD!); // test account from CI secrets
  await expect(page).toHaveURL('/dashboard');
  await page.context().storageState({ path: 'e2e/.auth/user.json' });
});
```
Test-account credentials come from env / CI secrets — never committed.

## Network Mocking
```typescript
test('shows error state when orders API fails', async ({ page }) => {
  await page.route('**/api/orders*', (route) => route.fulfill({ status: 500, json: { message: 'boom' } }));
  await page.goto('/orders');
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
});
```
Mock only for edge states (errors, empty, slow); happy paths hit a real test backend.

## Accessibility Scan
```typescript
import AxeBuilder from '@axe-core/playwright';

test('orders page has no a11y violations', async ({ page }) => {
  await page.goto('/orders');
  await expect(page.getByRole('list', { name: 'Orders' })).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations).toEqual([]);
});
```

## Visual Snapshot
```typescript
test('order card matches baseline', async ({ page }) => {
  await page.goto('/orders');
  await expect(page.getByRole('list', { name: 'Orders' })).toHaveScreenshot('orders-list.png', {
    mask: [page.getByTestId('relative-time')], // mask dynamic content
    maxDiffPixelRatio: 0.01,
  });
});
// update baselines: npx playwright test --update-snapshots
```
Baselines are OS/browser-specific — generate them in the CI image, not locally.

## Commands
- Run: `npx playwright test` · one file: `npx playwright test e2e/login.spec.ts`
- Debug: `npx playwright test --debug` · UI mode: `npx playwright test --ui`
- Report: `npx playwright show-report` · trace: `npx playwright show-trace trace.zip`
