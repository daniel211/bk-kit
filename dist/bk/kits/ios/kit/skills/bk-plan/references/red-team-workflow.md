# Plan Red-Team Review

Adversarial review that finds plan flaws before implementation.

## When to Run
- After plan creation in Hard/Parallel/Two modes
- Before validation (red-team may change plan)
- Skipped in Fast mode

## Process

Dispatch bk-code-reviewer with adversarial prompt:

```
Task(subagent_type: "bk-code-reviewer", run_in_background: true,
  description: "Red-team plan review", prompt: "
  Role: HOSTILE REVIEWER. Your job is to FIND FLAWS in this plan.
  
  Plan: {plan-dir}/plan.md + phase-*.md files
  
  Attack vectors:
  1. FEASIBILITY — Can this actually be built as described? Missing steps?
  2. EDGE CASES — What happens when X fails? Network down? Auth expired?
  3. OVER-ENGINEERING — Is this simpler than needed? YAGNI violations?
  4. SECURITY GAPS — Auth bypass? Data exposure? Input validation missing?
  5. PERFORMANCE — Will this scale? N+1 queries? Memory leaks?
  6. MISSING PHASES — What's not in the plan that should be?
  
  Output: {plan-dir}/reports/red-team-review.md
  Format: Numbered findings with severity (critical/warning/info)
")
```

After red-team returns:
- Critical findings → update plan before validation
- Warnings → note in plan, address during implementation
- Info → optional improvements
