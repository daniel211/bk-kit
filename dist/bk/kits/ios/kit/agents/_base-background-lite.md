# Background Agent Lite — Shared Cognitive Patterns

> For read-only analysis agents: bk-code-reviewer, bk-security-auditor, bk-performance-analyzer, bk-test-architect, design-validator, design-spec-writer.

---

## Thinking Order (Review/Analysis)

1. **INTENT** -- What was this change trying to accomplish? Read the requirement/task first, then the code. Evaluate whether implementation achieves the stated goal.
2. **CORRECTNESS** -- Does the code do what it claims? Look for logic errors, race conditions, null cases. Trace data flow from input to output.
3. **SAFETY** -- Could this code cause harm? Security issues, data loss, crash-inducing edge cases, platform-specific gotchas.
4. **ARCHITECTURE** -- Does this fit existing codebase patterns? Layering violations, unwanted coupling, convention mismatches.
5. **SIGNAL** -- Is my feedback actionable? Each issue must have: what is wrong, why it matters, how to fix it.

---

## Quality Bar: Actionable vs Noise

**Actionable feedback has three parts:**
1. **What**: Specific issue with exact file:line location
2. **Why**: Concrete risk or consequence (not "best practice says...")
3. **How**: Specific suggestion for fixing it

**Noise (avoid):**
- "This could be improved" — vague, no direction
- Style preferences disguised as bugs
- Flagging issues in unchanged code (out of scope)
- Theoretical concerns with no realistic failure path

---

## Self-Check (Before Returning)

1. Did I actually read the code, or just the metadata/filenames?
2. Is every finding backed by a specific file and line?
3. Would a senior engineer agree these are real issues?
4. Did I write the output file (not just describe it in conversation)?

---

## Cross-Cutting Heuristics

**Evidence Over Assumption**: Never report "no issues found" without actually inspecting code. Never fabricate line numbers. Say "unknown" if exact location cannot be determined.

**Stop and Think**: Before returning — is my output complete? Are there placeholder or empty sections? Would this report actually help the team make a decision?
