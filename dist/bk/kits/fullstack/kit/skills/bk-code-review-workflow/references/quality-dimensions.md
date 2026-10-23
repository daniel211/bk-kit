# Review Quality Dimensions — full rubric (bk-code-review-workflow)

Each dimension with its good and bad form. The SKILL.md body carries the short rule; this file
carries the contrast that makes it concrete.

## Agent Operational Quality

| Dimension | Good | Bad |
|-----------|------|-----|
| **Code inspection depth** | Read every changed file's actual source code — function bodies, error paths, logic branches. Cross-reference between files. | Read the impl report and trust it. Skim headers only. "The code looks fine." |
| **Cross-validation discipline** | Verify EVERY impl report claim: are `files_changed` accurate? Are `requirements_satisfied` actually implemented? Did the build really run if `build_verified: true`? | Trust the frontmatter. "The report says it's done, so it's done." |
| **Severity calibration** | Blocker = crash/data loss/security. Major = significant bug/architecture violation. Minor = readability/naming. | Everything is a blocker. Or everything is minor. Inflation wastes fix loops. Deflation ships bugs. |
| **Signal-to-noise ratio** | Every finding is actionable: what is wrong, why it matters, how to fix it. | Vague "could be improved." Style nits as majors. Laundry list of 20 minor items. |
| **Scope discipline** | Review only CHANGED code. Flag pre-existing issues only if the change made them worse. | Review the entire codebase. Flag issues in unchanged files. |
| **Pipeline awareness** | Focus on correctness, architecture, safety. Test coverage is the test agent's job. | Comment on test coverage. Duplicate what security-auditor will check. |
| **Evidence precision** | File path and line number for every finding. Show the actual code. | "Somewhere in the file..." Fabricated line numbers. Findings without location. |

## Review Craftsmanship Quality

| Dimension | Good | Bad |
|-----------|------|-----|
| **Finding structure** | Each finding: (1) what is wrong, (2) why it matters, (3) how to fix it, (4) severity, (5) file:line | Missing any of these 5 elements. |
| **Correctness focus** | Trace data flow. Check logic. What happens with null/empty/error? Follow the execution path. | Surface-level pattern matching only. |
| **Architecture alignment** | Check against THIS project's manifest — not generic best practices. | Apply textbook patterns that don't match this codebase. |
| **Safety awareness** | Check for injection, auth bypass, data exposure, crash-inducing edge cases. | Assume security is someone else's job. Skip error paths. |
| **Impl-result fidelity** | Compare each claim to actual code. Flag discrepancies. | Accept all claims at face value. |
| **Spec compliance** | When spec-index exists: verify sections read, edge cases addressed, anti-patterns avoided. Include `spec_compliance` in output. | Ignore spec-index. |
| **Proportional depth** | Spend more time on critical paths (auth, payment, data mutation) than display-only views. | Equal time on every file regardless of risk. |
| **TODO evaluation** | Linked to REQ and out-of-scope → informational. Vague `// TODO: fix later` → minor. Critical `// TODO: validate auth` → blocker. | Blindly flag all TODOs. Or ignore all TODOs. |

## Anti-Patterns

- **The Metadata Reviewer** — Reading the impl report's frontmatter and trusting it without inspecting actual source. Always read the code.
- **The Nit-Picker** — Style preferences disguised as majors. Import ordering is not a bug.
- **The Scope Creeper** — Reviewing unchanged code. You're reviewing THIS change.
- **The Vague Critic** — "This could be improved" without saying what, why, or how.
- **The Line Fabricator** — Can't find the exact line, guesses a number. Say "unknown" instead.
- **The Rubber Stamper** — "LGTM" without reading code. Every file, every function body.
- **The Test Commenter** — Flagging test coverage gaps — that's the test agent's job.
- **The Blocker Inflater** — Every finding is a blocker. Severity inflation causes unnecessary fix loops.
