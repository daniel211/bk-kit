# Visual Compare

Screenshot vs spec verification process. Run after writing design.md to ensure
spec accuracy. Required by Iron Law #1: NO SPEC WITHOUT VISUAL VERIFICATION.

## Process Per Screen

1. `Read` the `screenshot.png` — view every visual element
2. `Read` the `design.md` — check each element is captured
3. For each element visible in screenshot, verify:
   - Present in Layout Tree or Component Breakdown?
   - Text content matches (correct diacritics)?
   - Colors use `$token` (not raw hex)?
   - Positioning annotated (absolute/pinned/scroll)?
4. Fix gaps in `design.md` immediately (edit sections 1-8)
5. Append `## Visual Compare` section at the end of `design.md`

## Visual Compare Section Format

```markdown
## Visual Compare

**Status:** Verified | **Gaps found:** {count}

| # | Gap | Severity | Fix |
|---|-----|----------|-----|
| 1 | {description} | High/Medium/Low | Fixed / Not fixable (reason) |
```

If no gaps: `**Status:** Verified | **Gaps found:** 0`

## Verification Checklist

- [ ] Every visible element in screenshot is in spec
- [ ] No duplicate/phantom elements in spec that aren't in screenshot
- [ ] Text diacritics correct (Vietnamese: check "a" vs "a", "o" vs "o", etc.)
- [ ] `$token` references only (no raw hex in Layout Tree / Component Breakdown)
- [ ] Stroke widths explicit (not assumed)
- [ ] Layout model accurate (CENTER vs margin)
- [ ] HomeIndicator included if visible
- [ ] Safe area annotated
- [ ] Scroll containers marked if content exceeds viewport
- [ ] Z-order correct for overlapping elements

## Multi-Screen Flows

For multi-screen flows: run visual compare after ALL screens are written, as a final pass.
Fix gaps before marking flow complete.

## Anti-Patterns

### Phantom Elements from Hidden Nodes

**Problem:** Figma nodes with `visible: false` (e.g., hidden hint text, inactive icon slots)
can appear in the spec but NOT in the screenshot, creating false gaps.

**Prevention:**
- During extraction: skip nodes with `visible: false` in Layout Tree
- During visual compare: if spec has element NOT in screenshot, check if it was a hidden node
- Note hidden elements only in Component Breakdown states, not in Layout Tree

### Spec Says "No Notable Differences"

**Reject.** Every visual compare MUST read the screenshot first and cite specific elements checked.
"No notable differences" without evidence means the screenshot was not actually read.

### Phantom Elements from Connector Nodes

**Problem:** In multi-screen flows, CONNECTOR nodes (navigation arrows between screens)
can be mistaken for screen elements.

**Prevention:** Filter `type === "FRAME"` only during discovery phase.

## Severity Classification

| Severity | Criteria | Action |
|----------|----------|--------|
| **High** | Missing element, wrong text, wrong layout structure | Fix immediately |
| **Medium** | Wrong spacing, missing token, minor positioning | Fix if time allows |
| **Low** | Cosmetic (opacity, subtle shadow difference) | Note for reference |

## Timeout Exception

If agent is approaching timeout (Iron Law #1 exception):
- Mark `**Status:** Skipped (timeout)`
- Prioritize: design.md completeness > visual compare
- Visual compare can be run as follow-up by bk-visual-verify agent
