# When Stuck - Problem-Solving Dispatch

Different stuck-types need different techniques. Match stuck-symptom to technique.

## Dispatch Flowchart

```
YOU'RE STUCK
│
├─ Complexity spiraling? Same thing 5+ ways? Growing special cases?
│  └─→ USE: Simplification Cascades
│
├─ Can't find fitting approach? Conventional solutions inadequate?
│  └─→ USE: Collision-Zone Thinking
│
├─ Same issue different places? Reinventing wheels? Feels familiar?
│  └─→ USE: Meta-Pattern Recognition
│
├─ Solution feels forced? "Must be done this way"? Stuck on assumptions?
│  └─→ USE: Inversion Exercise
│
├─ Will this work at production? Edge cases unclear? Unsure of limits?
│  └─→ USE: Scale Game
│
└─ Code broken? Wrong behavior? Test failing?
   └─→ USE: Debugging skill (systematic-debugging)
```

## Stuck-Type → Technique Map

| How You're Stuck | Symptom Details | Use This |
|------------------|-----------------|----------|
| **Complexity spiraling** | Same thing 5+ ways, growing special cases, excessive if/else | simplification-cascades.md |
| **Need innovation** | Conventional inadequate, can't find fitting approach, need breakthrough | collision-zone-thinking.md |
| **Recurring patterns** | Same issue different places, reinventing wheels, déjà vu feeling | meta-pattern-recognition.md |
| **Forced by assumptions** | "Must be done this way", can't question premise, forced solution | inversion-exercise.md |
| **Scale uncertainty** | Production unclear, edge cases unknown, unsure of limits | scale-game.md |
| **Code broken** | Wrong behavior, test failing, unexpected output | debugging skill |

## Process

1. **Identify stuck-type** - What symptom matches above?
2. **Load that technique** - Read the specific reference file
3. **Apply technique** - Follow its process
4. **Document attempt** - What worked/failed?
5. **If still stuck** - Try different technique or combine

## Combining Techniques

Some problems need multiple techniques:

- **Simplification + Meta-pattern** - Find pattern → simplify all instances
- **Collision + Inversion** - Force metaphor → invert assumptions
- **Scale + Simplification** - Test extremes → reveal what to eliminate
- **Meta-pattern + Scale** - Universal pattern → test at extremes

## When Nothing Works

If no technique helps:
1. **Reframe problem** - Are you solving the right problem?
2. **Get fresh perspective** - Explain to someone else
3. **Take break** - Distance often reveals solution
4. **Simplify scope** - Solve smaller version first
5. **Question constraints** - Are they real or assumed?

## Remember

- Match symptom to technique
- One technique at a time
- Combine if first doesn't work
- Document what you tried
- Not stuck forever, just temporarily

## Technique Cheat-Sheet (key insight + red flag)

### 1. Simplification Cascades
Find one insight eliminating multiple components. "If this is true, we don't need X, Y, Z."

**Key insight:** Everything is a special case of one general pattern.

**Red flag:** "Just need to add one more case..." (repeating forever)

### 2. Collision-Zone Thinking
Force unrelated concepts together to discover emergent properties. "What if we treated X like Y?"

**Key insight:** Revolutionary ideas from deliberate metaphor-mixing.

**Red flag:** "I've tried everything in this domain"

### 3. Meta-Pattern Recognition
Spot patterns appearing in 3+ domains to find universal principles.

**Key insight:** Patterns in how patterns emerge reveal reusable abstractions.

**Red flag:** "This problem is unique" (probably not)

### 4. Inversion Exercise
Flip core assumptions to reveal hidden constraints. "What if the opposite were true?"

**Key insight:** Valid inversions reveal context-dependence of "rules."

**Red flag:** "There's only one way to do this"

### 5. Scale Game
Test at extremes (1000x bigger/smaller, instant/year-long) to expose fundamental truths.

**Key insight:** What works at one scale fails at another.

**Red flag:** "Should scale fine" (without testing)
