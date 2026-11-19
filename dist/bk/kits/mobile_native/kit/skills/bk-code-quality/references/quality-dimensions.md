# Quality Dimensions — full rubric (bk-code-quality)

Each dimension with its good and bad form. SKILL.md carries the short rule; this file carries the
contrast that makes it concrete.

## Agent Operational Quality

| Dimension | Good | Bad |
|-----------|------|-----|
| **Requirement fidelity** | Implement exactly what the spec says — no more, no less | Add "nice to have" features, skip edge cases, guess when ambiguous |
| **Scope discipline** | Change exactly the files needed for the task | "While I'm here" refactoring, improving adjacent code |
| **Output contract** | Impl report accurate: `files_changed` matches reality, `build_verified` from an actual build run | Missing report or fields, wrong paths, claim build passed without running |
| **Context efficiency** | Read plan → assess → code. Look up on-demand. | Read 30 files before writing first line of code |
| **Uncertainty handling** | Return `needs_info` when missing critical information | Guess, produce wrong code, read everything hoping to find the answer |
| **Evidence over assumption** | Build before claiming it compiles. Find a pattern before claiming it exists. | "Should compile", "I believe the pattern is..." |

## Code Craftsmanship Quality

Code is consumed by downstream agents (test agents, reviewers, security auditors) and maintained by future sessions. Write code that is testable, traceable, and changeable.

| Dimension | Good | Bad |
|-----------|------|-----|
| **Functions** | Small, focused, single responsibility. Pure when possible. Side effects isolated at boundaries. | 100+ line functions, mixed concerns, hidden side effects, cryptic names |
| **Logic** | Business logic in domain/service layer. Rules explicit, traceable to requirements. | Logic in UI layer, rules buried in nested conditionals |
| **State** | Minimal, explicit, in well-defined containers (ViewModel, Store, Service). | State scattered across layers, mutable globals, hidden dependencies |
| **Testability** | DI-friendly, mockable boundaries, no hidden deps. Downstream test agents can write tests. | Singletons, hardcoded deps, tightly coupled — untestable |
| **Extensibility** | Open for extension, closed for modification. Protocols/interfaces at boundaries. | Hardcoded behavior, concrete types everywhere, requires rewrite for next feature |
| **Patterns** | Match existing codebase. If repo uses Coordinator, add Coordinator. Reuse existing abstractions. | Introduce new pattern because "it's better". Add library for one function. |
| **TODOs** | Avoid. Implement or report in `info_needed`. Exception: out-of-scope with REQ link: `// TODO(REQ-045): ...` | `// TODO: fix later`, `// TODO: clean up`, vague placeholders |
| **Comments** | `@trace` markers for requirements. Comments explain WHY. | Comments explain WHAT code does. No trace markers. |

> Platform-specific conventions (language idioms, framework patterns, API guidelines) are covered by platform skills. The quality bar above applies universally.

## Anti-Patterns

- **"While I'm here"** — Refactoring adjacent code. Stay in scope.
- **Pattern invention** — Introducing patterns the codebase doesn't use.
- **God objects** — 100+ lines in one file/function. Decompose.
- **Swallowing errors** — Empty error handlers hide bugs.
- **Guessing over asking** — When uncertain, return `needs_info`. Don't produce wrong code.
- **Upfront reading marathon** — Reading 20+ files before writing code. Assess, then code.
- **Untestable code** — Hidden dependencies, singletons, tightly coupled. Downstream agents will fail.
- **Vague TODOs** — `// TODO: fix later` is not acceptable. Implement it or report it.
