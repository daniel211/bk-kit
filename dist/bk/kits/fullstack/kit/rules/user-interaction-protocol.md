# User Interaction Protocol

> Unified rules for when and how to interact with the user via AskUserQuestion.
> Applies to ALL skills and workflows.

---

## 1. When MUST Ask User (Mandatory)

| Situation | Why | Format |
|-----------|-----|--------|
| Confidence < 70% on any decision | Prevent wrong-path execution | Show options + recommendation |
| 2+ agents/sources disagree | Cannot auto-resolve conflict | Show both sides + analysis |
| Architecture change affecting > 3 files | High blast radius | Show impact + options |
| After 2 reactive escalation attempts fail | Exhausted automated options | Show what was tried + options |
| Commit changes | User approval required | Show diff summary |
| Create new plan (unless trivial fix) | Scope confirmation | Show plan summary |
| Create PR/MR | External-facing action | Show PR description |

## 2. When NOT to Ask User (Auto-Proceed)

| Situation | Action | Log |
|-----------|--------|-----|
| Confidence >= 70% | Proceed with best option | "Decided: {choice}, confidence: {pct}%" |
| Single clear approach | Proceed | — |
| Reactive dispatch (brainstormer/docs-seeker) | Auto-dispatch helper | "Reactive: dispatching {skill} for {signal}" |
| MCP fallback | Auto-switch | "MCP fallback: {from} → {to}" |
| Fix loop < max retries | Auto-retry | "Retry {n}/{max}" |
| Trivial tier decisions | Proceed | — |

## 3. AskUserQuestion Format

Every AskUserQuestion MUST include these 4 elements:

### Template:
```
**Context:** {1-2 sentences about current situation}
**Issue:** {what needs a decision}
**Options:**
1. {Recommended option} ← Recommended
2. {Alternative option}
3. {Conservative option — e.g., "Cancel" or "Add more context"}
**Why I recommend option 1:** {brief rationale}
```

### Good Example:
```
**Context:** Đang debug login timeout bug, đã retry 2 lần với cùng lỗi network timeout.
**Issue:** Fix approach cần thay đổi.
**Options:**
1. Dispatch brainstormer để tìm approach khác ← Recommended
2. Retry lần 3 với cùng approach
3. Dừng lại, tôi tự fix
**Why I recommend option 1:** 2 lần retry cùng lỗi cho thấy root cause khác với giả thuyết ban đầu.
```

### Bad Examples (DO NOT):
- "What should I do?" (no context)
- "Error occurred." (no options)
- "Choose: A or B" (no recommendation)
- Asking for information the system can find itself

## 4. Skill-Specific AskUserQuestion Rules

| Skill | When to Ask | When NOT to Ask |
|-------|------------|-----------------|
| bk-code | Phase fail after reactive escalation, architecture-impacting change | Normal phase transitions, agent dispatch |
| bk-debug | Confidence < 70%, fix loop max, build fail max | Classify, first analysis, first fix attempt |
| bk-plan | Researcher conflict, missing requirements, scope ambiguity | Research dispatch, scout dispatch |
| bk-refactor | Complex/cross-cutting scope, after limit reached | Obvious/small scope refactors |
| bk-review | — (never asks, only reports) | All review operations |
| bk-test | — (never asks, only reports) | All test operations |
| bk-bootstrap | Scout finds conflicting patterns, critical file missing | Normal scan operations |
| bk-commit | Always (commit gate) | — |

## 5. Confidence Reporting

### Agents MUST report confidence in output metadata:

```markdown
<!-- metadata: {..., "confidence": "high|medium|low", "confidence_reason": "clear evidence"} -->
```

### Definitions:
- **HIGH** (>= 80%): Clear evidence, single viable approach, verified outcome
- **MEDIUM** (50-79%): Some uncertainty, 2+ possible approaches, partial evidence
- **LOW** (< 50%): Significant uncertainty, contradicting evidence, need more info

### Conductor Response to Confidence:
- HIGH → Continue pipeline normally
- MEDIUM → Log warning, continue but monitor closely, flag in report
- LOW → Trigger reactive protocol per `reactive-orchestration.md`
