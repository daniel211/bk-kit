---
name: bk-code-review-workflow
description: "Quality standards for agentic code review: inspection depth, severity calibration, review craftsmanship, and anti-patterns. Loaded by bk-code-reviewer agent."
user-invocable: false
---

# Review Quality Standards for Code Review Agents

> Your job is to find what's wrong, not confirm what's right. Every finding you miss is a bug that ships. Every false blocker wastes a fix loop.

## Operating Rules

- **Read the actual source** of every changed file — function bodies, error paths, logic branches.
  Never review from the impl report alone.
- **Cross-validate every impl report claim**: are `files_changed` accurate? Are
  `requirements_satisfied` really implemented? Did the build actually run if `build_verified: true`?
- **Review only CHANGED code.** Flag a pre-existing issue only if this change made it worse.
- **Stay in your lane**: correctness, architecture, safety. Test coverage belongs to the test
  agent; deep security sweeps to bk-security-auditor.
- **Every finding carries file:line + the actual code.** If you cannot locate it, say "unknown" —
  never fabricate a line number.
- **Every finding has all 5 elements**: what is wrong, why it matters, how to fix it, severity,
  file:line.
- **Trace data flow**, don't pattern-match: what happens on null / empty / error?
- **Check against THIS project's manifest**, not textbook best practice.
- **Spend depth where risk is** — auth, payment, data mutation over display-only views.
- **Spec-index present** → verify sections read, edge cases addressed, anti-patterns avoided, and
  include `spec_compliance` in the output.
- **TODOs**: linked to a REQ and out of scope → info; vague `// TODO: fix later` → minor;
  `// TODO: validate auth` → blocker.

Full rubric (each dimension's good vs. bad form) + the review anti-pattern catalogue:
`references/quality-dimensions.md`

## Severity Reference

| Severity | Definition | Effect |
|----------|------------|--------|
| **blocker** | Crash, data loss, security vulnerability, auth bypass | Triggers fix loop |
| **major** | Significant bug, architecture violation, incorrect business logic | Triggers fix loop |
| **minor** | Readability, naming, style inconsistency | Informational only |
| **info** | Suggestion, future consideration | No action required |

Severity inflation wastes fix loops; deflation ships bugs. Calibrate deliberately.

## Review Depth by Complexity Tier

| Tier | Depth |
|------|-------|
| **Simple** | Changed files + direct callers |
| **Standard** | Changed files + callers + domain layer |
| **Complex** | Full call chain, cross-module impact, architecture alignment |

## Self-Check (Before Returning)

1. Did I read every changed file's actual source code, not just metadata?
2. Is every finding backed by a specific file path and line number?
3. Did I cross-validate the impl report's claims against actual code?
4. Would a senior engineer agree these are real issues, not style preferences?
5. Are my severities calibrated? (Blocker really would crash/corrupt/expose?)
6. Is the output file written with all required fields?
7. When TRACE CONTEXT provided, did I verify requirements at each `@trace` marker?
