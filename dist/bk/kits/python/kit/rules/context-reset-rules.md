# Context Reset Rules

Applies to: `complex` and `architectural` complexity tiers only.
Trivial/standard tiers use `/compact` (compaction) — no reset needed.

## When to Reset vs Continue

| Signal | Action |
|--------|--------|
| Context < 60% | Continue — no action |
| Context 60–74% | INFO advisory — plan to wrap up current task soon |
| Context 75–84% | WARN — finish current task, then `/clear` |
| Context >= 85% | CRITICAL — stop mid-task, `/clear` immediately |

## Reset Protocol

1. **Handoff doc auto-written** by `handoff-writer` at PreCompact or when >= 75%.
2. Find latest handoff: `bk/dev/shared/handoff/handoff-*.md` (newest file).
3. Run `/clear` in Claude Code.
4. In new session: read handoff doc → read `.workflow-state.json` → continue.

## Handoff Doc Contents
- Mission, current state (phase/batch), completed tasks, remaining tasks, decisions (WHY), file status, next instructions.
- Max 400 lines. Auto-pruned to latest 3 files.

## Why Reset > Compact for Complex Tier
- Opus 4.x xhigh inflates context ~3x vs high setting.
- Compaction degrades reasoning quality at high context levels.
- Hard reset + structured handoff preserves full reasoning quality for next batch.

## Scoping Rules
- **MUST NOT** create handoff for trivial or standard tier.
- Advisory messages only appear when `complexity_tier` is set in workflow state.
- Missing or unreadable state → no-op (fail-open).
