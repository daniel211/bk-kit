# Review Cycle

Transition: `test → review` (Standard/Complex only)

**Skip for Trivial tier.**

## Review Modes

Selected via SKILL.md arguments (`--auto`, `--review`, `--quick`).

### Autonomous Mode (`--auto`, default) — `review_mode: "auto"`

```
cycle = 0
LOOP:
  1. Dispatch bk-code-reviewer → score, critical_count, findings
     Task(subagent_type: "bk-code-reviewer", run_in_background: true, prompt: "
       Feature: {feature}
       Files changed: {files_from_impl_result}
       Output: bk/dev/shared/reports/code-review-{feature}.md
       Score format: X/10. List critical, warnings, suggestions.
     ")

  2. IF score >= 9.5 AND critical_count == 0:
     → "✓ Review {score}/10 - Auto-approved"
     → PROCEED to commit

  3. ELSE IF critical_count > 0 AND cycle < 2:
     → Resume dev agent with findings:
       Task(resume: dev_agent_id, prompt: "Review findings: {critical_issues}")
     → Re-dispatch bk-code-reviewer
     → cycle++, GOTO LOOP

  4. ELSE IF cycle >= 2:
     → ESCALATE: "Fix loop limit (2). Options: 1) Force continue, 2) Commit as-is, 3) Abort"

  5. ELSE (score < 9.5, no critical):
     → "✓ Review {score}/10 - Approved with {N} warnings"
     → PROCEED (warnings not blocking)
```

### Human-in-the-Loop Mode (`--review`) — `review_mode: "review"`

```
ALWAYS:
  1. Dispatch bk-code-reviewer → score, critical_count, findings

  2. Display findings to user:
     - Score: X/10
     - Critical (N): [list]
     - Warnings (N): [list]
     - Suggestions (N): [list]

  3. Ask user:
     IF critical_count > 0:
       Options: "Fix critical" / "Fix all" / "Approve anyway" / "Abort"
     ELSE:
       Options: "Approve" / "Fix warnings" / "Abort"

  4. Handle response:
     - Fix → resume dev agent, re-review (max 2 cycles)
     - Approve → proceed to commit
     - Abort → stop workflow
```

### Quick Mode (`--quick`) — `review_mode: "quick"`

Same as Autonomous but:
- Lower threshold: score >= 8.5 acceptable
- Max 1 auto-fix cycle (not 2)
- Focus on: correctness, security, no regressions only

## Critical Issues (Always Block — All Modes)

- Security vulnerabilities (OWASP top 10)
- Data loss/corruption risks
- Platform crashes (nil force-unwrap, null pointer, retain cycles)
- Performance bottlenecks (O(n²) when O(n) possible)
- Breaking API changes without migration
- Thread safety violations

## Complex Tier: Additional Reviewers

For Complex tier, dispatch ALL in ONE message:

```
Task(subagent_type: "bk-code-reviewer", ...)
Task(subagent_type: "bk-security-auditor", run_in_background: true, prompt: "...")
Task(subagent_type: "bk-performance-analyzer", run_in_background: true, prompt: "...")
```

## State Output

```json
{
  "current_phase": "review",
  "quality_fix_count": 0,
  "review_score": null,
  "reviewer_agent_id": null
}
```
