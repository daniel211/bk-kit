---
name: bk-code-quality
description: "Quality standards for agentic coding: agent operational quality, code craftsmanship, self-check protocol, and anti-patterns. Loaded by all dev agents."
user-invocable: false
allowed-tools: "Read Glob Grep"
---

# Code Quality Standards for Dev Agents

> Measures quality both as an autonomous worker and as a code author.

## Operating Rules

- **Implement exactly the spec** — no "nice to haves", no skipped edge cases, no guessing when
  ambiguous.
- **Stay in scope** — change exactly the files the task needs. No "while I'm here" refactoring.
- **Report accurately** — `files_changed` matches reality; `build_verified` only after an actual
  build run.
- **Read on demand** — plan → assess → code. Never a 20-file reading marathon first.
- **Uncertain → `needs_info`.** Do not produce wrong code and do not read everything hoping to
  find the answer.
- **Evidence over assumption** — build before claiming it compiles; find the pattern before
  claiming it exists.

## Craftsmanship Rules

Code is consumed by downstream agents (test, review, security) and maintained by future sessions.
Write it testable, traceable, changeable.

- **Functions** small and single-purpose; pure where possible, side effects isolated at boundaries.
- **Logic** in the domain/service layer, explicit and traceable to requirements — never buried in
  UI conditionals.
- **State** minimal and explicit, in well-defined containers (ViewModel, Store, Service).
- **Testability**: DI-friendly, mockable boundaries, no hidden deps, no singletons.
- **Extensibility**: protocols/interfaces at boundaries — open for extension, closed for
  modification.
- **Patterns match the codebase.** Reuse existing abstractions; never introduce a pattern or a
  library because "it's better".
- **TODOs**: implement it, or report it in `info_needed`. Only exception: out-of-scope with a REQ
  link — `// TODO(REQ-045): ...`.
- **Comments explain WHY**; add `@trace` markers wherever the sub-task's `reqs:` supplied IDs.

Platform-specific conventions (language idioms, framework patterns, API guidelines) come from the
platform skills. The bar above is universal.

Full rubric (good vs. bad per dimension) + the anti-pattern catalogue:
`references/quality-dimensions.md`

## Maturity-Aware Strictness

| Maturity | Approach |
|----------|----------|
| **disciplined** | Follow existing patterns strictly |
| **transitional** | Follow the strongest pattern, improve consistency |
| **legacy** | Introduce clean patterns locally, don't refactor surroundings |
| **greenfield** | Establish patterns from platform best practices |

## Self-Check (Before Returning)

1. Does the code build successfully? (actual build command, not "should compile")
2. Did I implement exactly what was required? Anything unnecessary?
3. Are functions small, focused, and testable? Can downstream test agents test this?
4. Is business logic in the right layer — domain/service, not UI or infrastructure?
5. Are there any TODOs? If so, are they linked to a REQ and explicitly out-of-scope?
6. Does this change match existing codebase patterns and architecture?
7. Is the impl report accurate and complete? `files_changed` matches actual changes? Required body sections present?
8. Did I add `@trace` markers where the sub-task `reqs:` provided IDs?
