# Runtime Awareness

Monitor context window utilization in real-time to optimize Beer Kit sessions.

> **Note**: Beer Kit provides runtime awareness via built-in hooks (statusline, checkpoint-save, context-safety).
> These hooks inject context usage data automatically — no manual setup required.

## Overview

Runtime awareness provides visibility into the critical metric:
- **Context Window** - Current token utilization within the active context limit

## Warning Indicators

| Level | Threshold | Indicator |
|-------|-----------|-----------|
| Normal | < 70% | Plain percentage |
| Warning | 70-89% | `[WARNING]` |
| Critical | ≥ 90% | `[CRITICAL]` |

## Recommendations by Threshold

### Context Window

| Utilization | Action |
|-------------|--------|
| < 70% | Continue normally |
| 70-80% | Plan compaction strategy |
| 80-90% | Execute compaction |
| > 90% | Immediate compaction or session reset |

## Compaction Strategy at Each Level

### 70% — Plan Ahead
- Identify largest context consumers (tool outputs, message history)
- Choose compaction method: anchored iterative summary preferred
- Avoid adding large retrieved docs

### 80% — Execute Compaction
- Summarize old turns using anchored iterative template
- Mask verbose tool outputs already processed
- Preserve: current task, key decisions, artifact trail
- Remove: supporting details, boilerplate, repeated outputs

### 90%+ — Immediate Action
- Stop current work, create session checkpoint
- Compact aggressively or start fresh sub-agent with summary handoff
- Pass only essential state: goal, decisions made, next steps, modified files

## Checkpoint Handoff Template

When handing off to a new agent due to context limits:

```markdown
## Handoff Summary
Goal: [original objective]
Progress: [what's done]
Files Modified: [list]
Key Decisions: [rationale]
Next Step: [immediate action]
Blockers: [if any]
```

## Monitoring Principles

1. Check context utilization before starting large operations (file reads, batch tool calls)
2. Prefer incremental processing over loading everything at once
3. Summarize completed phases before moving to the next
4. Use sub-agents for isolated subtasks when context is >60% full
5. Maintain an artifact trail throughout the session

## Related

- [Context Compression](./context-compression.md) - Compaction methods and templates
- [Context Optimization](./context-optimization.md) - Strategies to extend capacity
- [Multi-Agent Patterns](./multi-agent-patterns.md) - Isolation via sub-agents
