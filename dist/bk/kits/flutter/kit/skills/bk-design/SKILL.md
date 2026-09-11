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
3. **NO TEXT WITHOUT SOURCE** — all text copied from `raw/text.json` (`characters`) or from `componentProperties` in `raw/node.json`. Never manually transcribe, and never read text off the screenshot — especially Vietnamese diacritics.
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
| figma-data-guide.md | How both engines read Figma: CLI commands, output files, and field reference |
| error-handling.md | Timeout, MCP failures, degradation |

## Engines

The same extraction runs on either of two engines. **The output contract does not change**,
so nothing downstream is told which one ran.

| Engine | Discovery + per-screen spec | Asset export |
|--------|------------------------------|--------------|
| `auto` (**default**) | agy when the preflight passes, claude when it does not | design-asset-exporter |
| `claude` | design-validator, design-spec-writer | design-asset-exporter |
| `agy` | design-agy-extractor → `scripts/design-extract-agy.mjs` | design-asset-exporter |
| `dual` | both, to separate paths, then `scripts/design-spec-diff.mjs` | design-asset-exporter (claude) |

Select with `--engine`, `BK_DESIGN_ENGINE`, or `designEngine` in platform-context.json.

`auto` runs the preflight below **once per flow** and then behaves exactly like `agy` or
exactly like `claude` — it is a choice about which of the two to use, not a third behaviour.
It differs from typing `--engine agy` only in volume: on a machine that cannot run agy, `auto`
says one line and moves on, because that user never asked for agy and has nothing to fix,
while `--engine agy` prints the reason, the remedy and the allow-rule snippet. Check a machine
ahead of time with `bk doctor --design-engine`.

**The Iron Laws and this Self-Check apply identically to both engines.** The agy runner is
handed this file and the references verbatim rather than a restatement of them, and it
verifies files on disk — not the model's account of its work — before reporting success.

### Running the agy engine

Figma is read the same way on both engines — over REST, by `figma-cli.mjs`, before any model
is involved. So the agy engine needs no MCP server and no Figma setup beyond the token every
engine needs. What it does need:

1. `agy` on PATH, authenticated once by running it.
2. Narrow allow-rules in `~/.gemini/antigravity-cli/settings.json`, because headless agy
   cannot prompt for tool approval and auto-denies anything unapproved:
   ```json
   { "permissions": { "allow": [
       "read_file(*)", "write_file(/absolute/path/to/repo/bk/**)" ] } }
   ```
   The write rule is scoped to the repo's whole `bk/` tree, not to one flow: a rule that has
   to be re-added for every feature is a rule nobody keeps, which would make `auto` pick
   claude forever.
   The write rule must be an **absolute** path: agy checks permissions against the absolute
   path it resolved, and it resolves relative paths against its own workspace rather than the
   calling shell's directory. The runner prints the exact rule to add.

The kit prints these and never writes that file itself — it is shared with every other agy
session on the machine. `--dangerously-skip-permissions` is never used: it would auto-approve
every tool, shell commands included, on the user's repo. A run that cannot get permission
falls back to the claude engine.

## Downstream Consumers

| Consumer | Input | Purpose |
|----------|-------|---------|
| bk-generate | design.md sections 1-8 | Code generation |
| bk-code | design.md as context | Feature implementation |
| bk-visual-verify | screenshot.png + impl screenshot | Visual accuracy |
