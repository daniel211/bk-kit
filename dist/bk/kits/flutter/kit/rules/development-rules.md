# MK Development Rules

## Mobile-First Principles
- **Offline-first**: cache critical data locally, queue writes for sync
- **Battery**: avoid polling; use push notifications and background fetch
- **Memory**: release resources on background, lazy-load heavy assets
- **App lifecycle**: handle suspend/resume, state restoration, deep links
- **Network**: assume unreliable; show retry actions, optimistic UI updates

## Build & Test
- Use commands from `platform-context.json` (build, test, lint, run)
- Run `bk-bootstrap` on new projects to generate platform context
- DO NOT ignore failing tests to pass build — fix root cause
- DO NOT use mocks/fakes/tricks just to pass CI — implement real logic

## Skills & Agents
- Use `bk-*` skills: bk-code, bk-plan, bk-test, bk-debug, bk-review, bk-commit
- Use `bk-docs-seeker` for SDK/framework documentation lookup
- Use `bk-sequential-thinking` for complex debugging
- Delegate to bk-agents (bk-debugger, bk-code-reviewer, bk-unit-test-agent)

## Code Standards
- File size < 200 LOC; split into focused modules
- Kebab-case file names (descriptive, self-documenting for LLM tools)
- Clean Architecture: data → domain → presentation
- Platform-native UI patterns (Material / HIG)

## File Handling
- DO NOT create new enhanced/v2/refactored copies — update existing files directly
- No file duplication; if logic is shared, extract to a shared module
- After creating/modifying code, run compile immediately

## Plan Compliance
- Always follow the plan created by `bk-plan` — don't deviate without re-planning
- Execute phases sequentially unless plan explicitly allows parallel execution
- Mark phase TODOs as complete when done; update plan.md status

## Error Handling
- Build fails → delegate to `bk-debugger` to analyze (don't just retry blindly)
- Test fails → read failure report, fix root cause, re-run tests
- Fix loop limit: max 2 retries per `state-machine.md` — then escalate to user
- See `approval-rules.md` for risk-based gates on critical changes

## Pre-commit
- Conventional commit format, no AI references
- Never commit secrets (.env, API keys, credentials)
