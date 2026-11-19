# Visual Verification Scoring Criteria

## Score Weights

| Dimension | Weight | Rationale |
|-----------|--------|-----------|
| Layout Structure | 30% | Most impactful — wrong layout breaks the entire screen |
| Colors | 20% | Brand identity and visual consistency |
| Spacing & Padding | 20% | Affects readability and visual rhythm |
| Typography | 15% | Text hierarchy and readability |
| Alignment | 15% | Polish and professionalism |

**Weighted Score Formula:**
```
score = (layout * 0.30) + (colors * 0.20) + (spacing * 0.20) + (typography * 0.15) + (alignment * 0.15)
```

## Pass Threshold

- Default threshold: **85**
- Override with `--threshold <value>` (range: 0-100)
- Recommendation: use 90+ for pixel-perfect design systems, 75+ for iterative development

## Severity Levels

### Critical (must fix before commit)
- Layout is structurally broken
- Major sections or components are missing entirely
- Screen structure completely differs from design
- Core navigation elements absent or misplaced
- Example: "Bottom tab bar missing", "Header overlaps content"

### Major (should fix before PR merge)
- Wrong brand colors used (e.g., #FF0000 instead of #E53935)
- Significant spacing issues (e.g., 40px gap vs 8px gap)
- Important text style differences (e.g., body text shown as heading size)
- Component misalignment beyond 16px
- Example: "Button background is gray instead of primary blue"

### Minor (can fix in follow-up PR)
- Slight color shade variations within acceptable tolerance (±10% lightness)
- Small padding differences (±4px)
- Font weight differences that don't change perceived hierarchy
- Pixel-level alignment issues
- Example: "Icon has 1px offset from center"

## Interpretation Guide

| Score Range | Interpretation | Recommended Action |
|-------------|----------------|--------------------|
| 95-100 | Pixel-perfect | Commit immediately |
| 85-94 | Pass — minor deviations | Commit, log minor issues |
| 75-84 | Near-pass — review needed | Fix majors before commit |
| 60-74 | Fail — significant issues | Fix all majors and criticals |
| 0-59 | Fail — major rework needed | Re-implement UI from scratch |

## Common Failure Patterns

1. **Wrong theme colors** — developer used hardcoded colors instead of design tokens
2. **Missing responsive behavior** — tested on wrong device size
3. **Font not loaded** — system fallback font used instead of design font
4. **Incorrect padding scale** — using 16px system instead of design's 12px base
5. **Component library mismatch** — using default component instead of custom branded variant
