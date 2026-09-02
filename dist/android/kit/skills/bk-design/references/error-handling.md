# Error Handling

Timeout, MCP failures, and graceful degradation strategies for Figma MCP-dependent screen extraction.
Agent must produce useful output even when MCP calls fail or time out.

## Timeout Priority

When time runs low, prioritize deliverables in this order:

| Priority | Deliverable | Value | Deferrable? |
|----------|-------------|-------|-------------|
| 1 | design.md (even partial) | High — spec is core output | No |
| 2 | screenshot.png | High — visual reference standalone | No |
| 3 | Assets export | Medium — can follow up | Yes |
| 4 | Visual compare | Medium — can follow up | Yes |

**Rule:** A partial design.md with "[MCP UNAVAILABLE]" flags is better than no output.

---

## MCP Failure Ladder

4 levels of escalating failure, each with a specific response:

### Level 1: Single Tool Timeout (>30s)

**Symptom:** One MCP call takes longer than expected.
**Action:** Retry with reduced depth.

```
get_design_context(nodeId, depth=5) -> timeout
  -> Retry: get_design_context(nodeId, depth=3)
  -> Still timeout: get_design_context(nodeId, depth=1) + selective deep-dive
```

### Level 2: Tool Returns Error

**Symptom:** MCP tool returns an error response.
**Action:** Try alternative tool.

| Failed Tool | Alternative |
|-------------|------------|
| `get_design_context` | `get_node` per child |
| `scan_text_nodes` | `characters` field from deeper get_design_context |
| `get_styles` | Style names from get_design_context nodes |
| `save_screenshots` (disk) | `get_screenshot` (inline, base64) |
| `get_variable_defs` | `boundVariables` IDs from get_design_context |

### Level 3: MCP Server Unresponsive

**Symptom:** Multiple tools fail, server not responding.
**Action:** Write partial results with "[MCP UNAVAILABLE]" flags.

```markdown
## Design Tokens
[MCP UNAVAILABLE] — get_styles failed. Token names from node style names only.

| Token | Hex | Figma Style |
|-------|-----|-------------|
| $primary-brand-500 | [unknown] | Primary/Brand/500 (from fillStyleName) |
```

### Level 4: Response Truncated

**Symptom:** Large response cut off mid-data.
**Action:** Progressive depth fallback.

```
depth=5 truncated -> depth=3 per section -> depth=1 + selective deep-dive
```

For each section:
1. `get_design_context(sectionId, depth=1)` — identify children
2. `get_design_context(childId, depth=2)` — per important child
3. Stop when enough data for design.md section

---

## Frame Size to Time Estimates

Rough estimates for planning. Actual time depends on node complexity.

| Frame Height | Complexity | Estimated Time | Strategy |
|-------------|-----------|----------------|----------|
| < 400px | Simple | 20-30s | Single call, depth=3 |
| 400-800px | Medium | 30-60s | Single call, depth=3 |
| > 800px | Complex | 1-3min | Section-based parallel |
| > 1500px | Very tall | 2-4min | Section-based + aggressive depth management |

---

## Partial Result Strategy

When forced to deliver partial results (timeout or persistent MCP failure):

### What to Include

- Header section with source URL and frame info (from initial get_design_context)
- Screen Structure (ASCII wireframe from screenshot)
- Partial Layout Tree (whatever depth was achieved)
- Text Content (from scan_text_nodes if available)
- screenshot.png (saved early in pipeline)

### What to Flag

Mark incomplete sections with `[PARTIAL]` or `[MCP UNAVAILABLE]`:

```markdown
## Layout Tree
[PARTIAL — depth=3 achieved, deeper components not expanded]

Screen (375x812, $bg-white)
  VStack(gap=0)
    <HeaderApp title="..." />
    Content [PARTIAL — children not expanded]
    <Button label="Tiep tuc" />
```

### Self-Check Adjustments

When partial:
- [ ] design.md exists? (even partial)
- [ ] screenshot.png saved?
- [ ] Partial sections flagged with [PARTIAL] or [MCP UNAVAILABLE]?
- [ ] Visual Compare marked as "Skipped (timeout)" or "Skipped (MCP failure)"?

---

## Common Issues and Solutions

### get_design_context returns "Node not found"

The Figma file may not be active in the desktop app. Ask user to open the file,
or try `save_screenshots` first (may work independently).

### Screenshot too large for inline display

Tall/complex frames produce large base64. Use `save_screenshots` to save directly
to disk instead of `get_screenshot` inline.

### save_screenshots rejects path

Use relative paths only: `mk/dev/{flow}/{screen-slug}/file.png`

### Text content missing diacritics

Always use `characters` field from TEXT nodes in get_design_context.
Never manually transcribe Vietnamese text.

### Complex screen with 50+ nodes

Use section-based parallel extraction:
- `depth=1` for overview
- `depth=2-3` per section in parallel
- Selective deep-dive on unknown components (max 3)

### Figma output is truncated

Progressive depth: `depth=1` for structure, then fetch specific nodes individually
with `get_design_context` at higher depth.

### scan_text_nodes fails on mixed-format text

Bug was fixed in read-handlers.ts (isMixed checks for fontSize and fontName).
If still failing: fall back to `characters` field from deeper get_design_context.
