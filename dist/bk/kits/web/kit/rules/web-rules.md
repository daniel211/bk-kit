# Web Platform Rules

## Language & Conventions
- TypeScript (latest stable), `strict: true`; no `any` (use `unknown` + narrowing), no `@ts-ignore`
- kebab-case: files and folders (`user-profile-card.tsx`); PascalCase.tsx for components is also common — match project
- PascalCase: components, types, interfaces, enums
- camelCase: variables, functions, hooks (`useUserProfile`), props
- UPPER_SNAKE_CASE: module-level constants
- Named exports over default exports (except where the framework requires: Next.js `page.tsx`, `layout.tsx`)

## Component Patterns
- Function components + hooks only; no class components (error boundary excepted)
- Rules of Hooks: top level only, complete dependency arrays (`react-hooks/exhaustive-deps` on)
- Props typed with an explicit `type XProps`; no prop drilling > 2 levels — use composition or context
- Extract components > ~150 lines; one component per file
- Stable `key` from data ids, never array index for dynamic lists
- Derive state during render; `useEffect` only to sync with external systems, not to compute state
- Next.js App Router: Server Components by default, `'use client'` only at the interactive leaf

## Dependencies
- One package manager per repo (npm or pnpm); lockfile committed, CI uses `npm ci` / `pnpm install --frozen-lockfile`
- Pin exact versions for runtime deps; no `latest` / `*`
- Check bundle cost (bundlephobia) and maintenance before adding; prefer platform APIs
- `npm audit` / `pnpm audit` clean of high/critical before merge

## Project Structure
```
src/
├── app/                    # Next.js routes (or routes/ + main.tsx for Vite)
├── features/
│   ├── auth/
│   │   ├── components/
│   │   ├── hooks/          # useLogin, query/mutation hooks
│   │   ├── api/            # typed requests + zod schemas
│   │   └── types.ts
│   └── orders/
├── shared/
│   ├── api/                # http client, error normalization
│   ├── components/         # design-system primitives
│   ├── hooks/
│   └── lib/                # pure utilities
└── test/                   # render helpers, MSW server + handlers

e2e/                        # Playwright specs + page objects
```

## Testing
- Co-locate: `login-form.tsx` + `login-form.test.tsx`
- Query by role/label (`getByRole`), never by class name or test id first
- Network mocked with MSW at the HTTP boundary — not by mocking `fetch` or hooks

## Build & Test Commands
- Build: `npm run build`
- Typecheck: `npx tsc --noEmit`
- Test: `npx vitest run --coverage`
- Lint: `npx eslint .` (incl. `jsx-a11y`, `react-hooks`)
- Format: `npx prettier --write .`
- E2E: `npx playwright test`
