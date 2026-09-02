---
name: bk-design
description: "Single-screen design extraction methodology and spec format."
user-invocable: false
---

# Design Extraction Methodology

Provides methodology, spec format and quality rules for extracting a **single Figma screen** into a structured design.md.

## Iron Laws

1. **NO SPEC WITHOUT VISUAL VERIFICATION** — every design.md MUST pass visual compare before "complete". Exception: timeout — mark "Visual Compare: Skipped (timeout)".
2. **NO RAW HEX OUTSIDE DESIGN TOKENS** — Layout Tree, Component Breakdown use `$token` references only. Hex values ONLY in Section 4 (Design Tokens).
3. **NO TEXT WITHOUT SOURCE** — all text from `characters` field or `componentProperties` in get_design_context. Never manually transcribe — especially Vietnamese diacritics.
4. **NO ASSUMED DIMENSIONS** — all sizes, spacing, stroke widths from Figma data. Unknown values flagged with `⚠`. "⚠ no token" is honest; "16px" without source is a lie.

## Output Contract

Agent extracts ONE screen per call:

```
{flow}/{NN-slug}/
├── design.md         ← structured spec
├── screenshot.png    ← screenshot at 2x
└── assets.json       ← structured asset list for export pipeline
```

## Self-Check (before "complete")

- [ ] design.md has all 9 sections
- [ ] Every `$token` in Layout Tree and Component Breakdown defined in Section 4 Design Tokens
- [ ] screenshot.png exists (Glob check)
- [ ] Section 8 Node IDs all match `\d+:\d+` or `I\d+:\d+(;\d+:\d+)*` pattern — zero descriptions
- [ ] Asset names use `ic-`/`img-`/`bg-` prefixes only
- [ ] Zero raw hex outside Section 4 Design Tokens
- [ ] Section 9 Visual Compare present (mark "Skipped (timeout)" if needed — never omit)
- [ ] componentProperties text verified against screenshot
- [ ] Descriptive content in Vietnamese
- [ ] Section 4.3 Gradients: all GRADIENT_* fills have stops% + angle° (not just "N/A")
- [ ] Section 4.4 Effects: effects[] scanned — table filled if non-empty, N/A only if verified empty
- [ ] Section 2 Safe Area: header/footer strategy stated (behavioral, not platform-specific syntax)
- [ ] Section 6.3 Sheet Config: present for sheets/popups; N/A only for full-screen
- [ ] Every frame has `h=` in Section 2 Layout Tree (including HUG frames)

## References

| Reference | Content |
|-----------|---------|
| extraction-workflow.md | Screen extraction methodology (acquisition, token mapping, special patterns) |
| design-md-format.md | 9-section design.md format |
| visual-compare.md | Screenshot vs spec verification |
| mcp-tools-guide.md | MCP tool surface + decision matrix |
| error-handling.md | Timeout, MCP failures, degradation |

## Downstream Consumers

| Consumer | Input | Purpose |
|----------|-------|---------|
| bk-generate | design.md sections 1-8 | Code generation |
| bk-code | design.md as context | Feature implementation |
| bk-visual-verify | screenshot.png + impl screenshot | Visual accuracy |
