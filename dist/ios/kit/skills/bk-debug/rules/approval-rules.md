# Approval Rules

## Escalation = AskUserQuestion

Every "escalate" in this skill means: use `AskUserQuestion` tool to present options to user.
Never silently proceed, abort, or log-only when escalating.

## Checkpoints

### Phase 2: Root Cause Approval

After analysis, present root cause + proposed fix to user.

**Confusion Escalation:** If any of these conditions are true, ask user BEFORE proceeding to Phase 3:
- Multiple conflicting hypotheses (scouts disagree on root cause)
- Confidence < 70% (no clear evidence trail from symptom → cause)
- Root cause spans multiple unrelated modules
- Fix requires changing shared/core code (blast radius unclear)

```
AskUserQuestion:
  question: "Root cause analysis found [N] possible causes with [confidence]% confidence. Which direction?"
  options:
    - "Proceed with [top hypothesis]" (if confidence >= 50%)
    - "Investigate [alternative hypothesis] further"
    - "Provide more context" — user adds info
    - "Try a different approach"
```

**Clear case (confidence >= 70%, single hypothesis):**
- `--auto` mode: show root cause summary, proceed without asking
- `--review` mode: always ask approval
- `--quick` mode: show root cause summary, proceed without asking

### Phase 5: Review Escalation

After review score received:

| Mode | Score >= 9.5 | Score < 9.5, no critical | Critical issues |
|------|-------------|------------------------|-----------------|
| auto | Proceed | Proceed (log warnings) | Auto-fix, max 2 cycles then escalate |
| review | Always ask | Always ask | Always ask |
| quick | Proceed if >= 8.5 | Proceed (log warnings) | 1 cycle then escalate |

### Fix Loop Exhausted (max cycles reached)

```
AskUserQuestion:
  question: "Fix loop reached max [N] cycles. Review still reports [issues]. How to proceed?"
  options:
    - "Fix manually" — user takes over
    - "Approve with known issues" — proceed to commit
    - "Abort" — stop workflow, no commit
```

### Build Failure Exhausted (3 attempts)

```
AskUserQuestion:
  question: "Build failed [3] times. Last error: [summary]. How to proceed?"
  options:
    - "Show full error" — display build log
    - "Try different approach" — re-analyze
    - "Abort" — stop workflow
```

## Mode Behavior Summary

| Checkpoint | --auto | --review | --quick |
|-----------|--------|----------|---------|
| Root cause (clear) | Proceed | Ask | Proceed |
| Root cause (confuse) | **Ask** | Ask | **Ask** |
| Fix approval | Proceed | Ask | Proceed |
| Review pass | Proceed | Ask | Proceed |
| Review fail (critical) | Auto-fix 2x → ask | Ask | Auto-fix 1x → ask |
| Commit | Ask | Ask | Ask |
