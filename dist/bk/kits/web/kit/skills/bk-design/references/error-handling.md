# Error Handling

Timeout, fetch failures, and graceful degradation for screen extraction.

Figma is read over its REST API by `.claude/scripts/figma-cli.mjs`; there is no MCP server in
this path. A failed fetch is a CLI exit code with a message, not a silent empty tool result.
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
figma-cli nodes (nodeId, depth=5) -> timeout
  -> Retry: figma-cli nodes (nodeId, depth=3)
  -> Still timeout: figma-cli nodes (nodeId, depth=1) + selective deep-dive
```

### Level 2: Tool Returns Error

**Symptom:** MCP tool returns an error response.
**Action:** Try alternative tool.

| Failed Tool | Alternative |
|-------------|------------|
| `figma-cli screen` | `figma-cli nodes` per child branch |
| `raw/text.json` | `characters` fields inside `raw/node.json` |
| `raw/styles.json` | `styleRefs` on nodes in `raw/node.json` |
| `figma-cli export` (disk) | `figma-cli export --format png` (always to disk) |
| `raw/variables.json` | `boundVariables` ids in `raw/node.json` |

### Level 3: MCP Server Unresponsive

**Symptom:** Multiple tools fail, server not responding.
**Action:** Write partial results with "[MCP UNAVAILABLE]" flags.

```markdown
## Design Tokens
[DEGRADED] — styles.json unavailable. Token names from node style names only.

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
1. `figma-cli nodes (sectionId, depth=1)` — identify children
2. `figma-cli nodes (childId, depth=2)` — per important child
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

- Header section with source URL and frame info (from `raw/discovery.json`)
- Screen Structure (ASCII wireframe from screenshot)
- Partial Layout Tree (whatever depth was achieved)
- Text Content (from `raw/text.json` if available)
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

### figma-cli nodes returns "Node not found"

The Figma file may not be active in the desktop app. Ask user to open the file,
or try `figma-cli export` first (it uses a different endpoint).

### Screenshot too large for inline display

Tall or complex frames render slowly. `figma-cli export` writes straight to disk
to disk instead of `get_screenshot` inline.

### figma-cli export rejects the path

Use relative paths only: `bk/dev/{flow}/{screen-slug}/file.png`

### Text content missing diacritics

Always use `characters` field from TEXT nodes in figma-cli nodes.
Never manually transcribe Vietnamese text.

### Complex screen with 50+ nodes

Use section-based parallel extraction:
- `depth=1` for overview
- `depth=2-3` per section in parallel
- Selective deep-dive on unknown components (max 3)

### Figma output is truncated

Progressive depth: `depth=1` for structure, then fetch specific nodes individually
with `figma-cli nodes` at higher depth.

### raw/text.json fails on mixed-format text

Bug was fixed in read-handlers.ts (isMixed checks for fontSize and fontName).
If still failing: fall back to `characters` field from deeper figma-cli nodes.
