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
- Explicit `type XProps`; no prop drilling > 2 levels (composition or context)
- Extract components > ~150 lines; one component per file
- Stable `key` from data ids, never array index for dynamic lists
- Derive state during render; `useEffect` only to sync with external systems, not to compute state

## Framework Variants
`framework` in `.claude/platform-context.json` (missing = `generic`: match the existing setup).

### Next.js (App Router)
- `src/app/` routes (`page`/`layout`/`loading`/`error.tsx`); Server Components by default, `'use client'` only at the interactive leaf
- Every Server Action and route handler is a public endpoint: authn + zod parse + owner filter inside it; middleware is a coarse gate, not authz
- Secrets only in `import 'server-only'` modules; `NEXT_PUBLIC_*` is inlined into the client bundle
- Set `cache` / `revalidate` explicitly; per-user data never shared-cached

### Vite SPA
- `main.tsx` + data router with `lazy` routes; route guards are UX only — the API enforces authz
- `import.meta.env.VITE_*` is public: no keys or secrets; `server.proxy` is dev-only
- Auth via HttpOnly cookie from the API/BFF; never tokens in `localStorage`/`sessionStorage`

## Dependencies
- One package manager per repo (npm or pnpm); lockfile committed, CI uses `npm ci` / `pnpm install --frozen-lockfile`
- Pin exact runtime versions (no `latest` / `*`); check bundle cost before adding; prefer platform APIs
- `npm audit` / `pnpm audit` clean of high/critical before merge

## Project Structure
- `src/app/` (Next routes) or `src/routes/` + `main.tsx` (Vite)
- `src/features/<feature>/{components,hooks,api,types.ts}` — `api/` typed requests + zod, `hooks/` query hooks
- `src/shared/{api,components,hooks,lib}` — http client, design-system primitives, pure utils
- `src/test/` render helpers + MSW handlers; `e2e/` Playwright specs + page objects

## Testing
- Co-locate: `login-form.tsx` + `login-form.test.tsx`
- Query by role/label (`getByRole`), never by class name or test id first
- Mock the network with MSW, not `fetch` or hooks

## Commands
Use `commands.*` from platform-context (build, typecheck, test — Vitest or Jest, lint incl. `jsx-a11y` + `react-hooks`, format, e2e).
