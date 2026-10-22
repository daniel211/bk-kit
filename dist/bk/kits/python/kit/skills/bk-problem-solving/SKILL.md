---
name: bk-problem-solving
user-invocable: true
description: "Systematic techniques when stuck: complexity spirals, innovation blocks, recurring patterns, assumption constraints, scale uncertainty."
version: 2.0.0
argument-hint: "[problem description]"
triggers:
  - signal: agent_stuck
    condition: "retry_count >= 3 OR same error pattern repeating"
  - signal: fix_loop_stuck
    condition: "fix_cycles >= 3"
  - signal: build_fail_repeated
    condition: "build error after 2+ retries"
---

# Problem-Solving Techniques

Systematic approaches for different types of stuck-ness. Each technique targets specific problem patterns.

## When to Use

Apply when stuck: complexity spiraling, innovation block, a recurring cross-domain pattern, an
assumption you cannot question, scale uncertainty — or general stuck-ness where the technique is
not obvious (then start from `references/when-stuck.md`).

## Technique Dispatch

| Stuck symptom | Technique | Key insight | Reference |
|---|---|---|---|
| Same thing implemented 5+ ways, growing special cases ("just one more case…") | **Simplification Cascades** | Everything is a special case of one general pattern | `references/simplification-cascades.md` |
| Conventional solutions inadequate ("I've tried everything in this domain") | **Collision-Zone Thinking** | Revolutionary ideas come from deliberate metaphor-mixing | `references/collision-zone-thinking.md` |
| Same issue in different places, reinventing wheels ("this problem is unique") | **Meta-Pattern Recognition** | Patterns in how patterns emerge reveal reusable abstractions | `references/meta-pattern-recognition.md` |
| Solution feels forced ("there's only one way to do this") | **Inversion Exercise** | Valid inversions expose the context-dependence of "rules" | `references/inversion-exercise.md` |
| Production readiness unclear ("should scale fine", untested) | **Scale Game** | What works at one scale fails at another | `references/scale-game.md` |
| Unsure which technique applies | **When Stuck** | Decision tree first, technique second | `references/when-stuck.md` |

## Application Process

1. **Identify stuck-type** - Match symptom to technique above
2. **Load detailed reference** - Read specific technique from `references/`
3. **Apply systematically** - Follow technique's process
4. **Document insights** - Record what worked/failed
5. **Combine if needed** - Some problems need multiple techniques

## Combining Techniques

Powerful combinations:
- **Simplification + Meta-pattern** - Find pattern, then simplify all instances
- **Collision + Inversion** - Force metaphor, then invert its assumptions
- **Scale + Simplification** - Extremes reveal what to eliminate
- **Meta-pattern + Scale** - Universal patterns tested at extremes

## References

Load detailed guides as needed:
- `references/when-stuck.md` - Dispatch flowchart and decision tree
- `references/simplification-cascades.md` - Cascade detection and extraction
- `references/collision-zone-thinking.md` - Metaphor collision process
- `references/meta-pattern-recognition.md` - Pattern abstraction techniques
- `references/inversion-exercise.md` - Assumption flipping methodology
- `references/scale-game.md` - Extreme testing procedures
- `references/attribution.md` - Source and adaptation notes
