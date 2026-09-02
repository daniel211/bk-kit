# MCP Tools Guide

Complete reference for Figma MCP tools used in design extraction.
Single source of truth for tool categories, capabilities, and decision matrix.

## Tool Categories

### Core Tools (every extraction)

| Tool | Purpose | Key Parameters |
|------|---------|---------------|
| `get_design_context` | Node structure, styles, layout, text | `nodeId`, `depth` (1-5), `detail` (minimal/compact/full) |
| `save_screenshots` | Screenshot to disk, asset export | `items[]`, `scale`, `format` (PNG/PDF/SVG) |

### Enhancement Tools (once per flow, cached)

| Tool | Purpose | Key Parameters |
|------|---------|---------------|
| `get_styles` | Paint styles (including gradients), text styles, effect styles | — |
| `get_fonts` | Font inventory for the file | — |
| `get_node` | Full node data when truncated by depth limit | `nodeId` |
| `get_variable_defs` | Design token collections with modes (Light/Dark) | — |

### Discovery Tools (when needed)

| Tool | Purpose | Key Parameters |
|------|---------|---------------|
| `search_nodes` | Find nodes by name or type | `query`, `types[]` |
| `scan_text_nodes` | All text nodes under a subtree (any depth) | `nodeId` |
| `scan_nodes_by_types` | Filter nodes by type (FRAME, INSTANCE, etc.) | `nodeId`, `types[]` |
| `get_local_components` | Component inventory with property definitions | — |

### Preview Tools (quick check only)

| Tool | Purpose | Key Parameters |
|------|---------|---------------|
| `get_screenshot` | Inline base64 image (NOT for export) | `nodeId`, `scale` |

---

## Decision Matrix

| Need | Primary Tool | Fallback |
|------|-------------|----------|
| Structure overview | `get_design_context(depth=1)` | — |
| Full extraction | `get_design_context(depth=3)` + section-parallel | `get_node` per child |
| Text content | `characters` field from get_design_context | `scan_text_nodes` |
| Instance text values | `componentProperties` from get_design_context | deep-dive into INSTANCE children |
| Design tokens | `get_styles` + `get_variable_defs` | style names from get_design_context |
| Component contracts | `get_local_components` + depth=3 per component | manual extraction from screens |
| Find component by name | `search_nodes` | manual scan |
| Screenshot to disk | `save_screenshots(scale=2)` | — |
| Icon export (vector) | `save_screenshots(format=PDF)` | `format=SVG` |
| Image export (raster) | `save_screenshots(format=PNG, scale=1/2/3)` | — |
| Multi-screen discovery | `get_design_context(depth=1)` on PAGE/SECTION | `scan_nodes_by_types(types=["FRAME"])` |
| Quick visual check | `get_screenshot` | Read saved PNG |
| Mixed text styles | `styledSegments` from get_design_context / scan_text_nodes | — |

---

## Serializer Fields Reference

Fields available in `get_design_context` responses after enhanced serializer:

### Layout & Structure

| Field | Location | Values | Notes |
|-------|----------|--------|-------|
| `layoutMode` | styles | `HORIZONTAL`, `VERTICAL` | Auto-layout direction |
| `itemSpacing` | styles | number | Gap between children |
| `primaryAxisAlignItems` | styles | `MIN`, `CENTER`, `MAX`, `SPACE_BETWEEN` | Main axis alignment |
| `counterAxisAlignItems` | styles | `MIN`, `CENTER`, `MAX`, `BASELINE` | Cross axis alignment |
| `layoutSizingHorizontal` | styles | `FIXED`, `FILL`, `HUG` | Width sizing mode |
| `layoutSizingVertical` | styles | `FIXED`, `FILL`, `HUG` | Height sizing mode |
| `padding` | styles | `{top, right, bottom, left}` | Auto-layout padding |
| `clipsContent` | styles | boolean | Overflow hidden when true |
| `layoutWrap` | styles | `WRAP` | Multi-row layout (only present when WRAP) |
| `counterAxisSpacing` | styles | number | Row gap in wrapped layouts |
| `layoutPositioning` | styles | `ABSOLUTE` | Absolute positioning within auto-layout (only when ABSOLUTE) |

### Visual Properties

| Field | Location | Values | Notes |
|-------|----------|--------|-------|
| `fills` | styles | `["#hex"]` or gradient/image object | Solid, gradient, or image fills |
| `strokes` | styles | `["#hex"]` or gradient object | Stroke paints |
| `strokeWeight` | styles | number or `"mixed"` | Border thickness |
| `strokeAlign` | styles | `INSIDE`, `CENTER`, `OUTSIDE` | Border position |
| `cornerRadius` | styles | number or `"mixed"` | Corner radius |
| `topLeftRadius` | styles | number | Individual corner (when mixed) |
| `topRightRadius` | styles | number | Individual corner (when mixed) |
| `bottomLeftRadius` | styles | number | Individual corner (when mixed) |
| `bottomRightRadius` | styles | number | Individual corner (when mixed) |
| `opacity` | styles | number (0-1) | Only present when < 1 |
| `effects` | styles | array of effect objects | Shadows, blur |
| `boundVariables` | styles | `{prop: {id}}` | Design token variable bindings |

### Effect Object Shape

```json
{
  "type": "DROP_SHADOW | INNER_SHADOW | LAYER_BLUR | BACKGROUND_BLUR",
  "color": "#hex",
  "offset": { "x": 0, "y": 2 },
  "radius": 8,
  "spread": 0,
  "opacity": 0.08
}
```

### Gradient Fill Shape

```json
{
  "type": "GRADIENT_LINEAR | GRADIENT_RADIAL | GRADIENT_ANGULAR | GRADIENT_DIAMOND",
  "stops": [
    { "color": "#hex", "position": 0.0, "opacity": 1 },
    { "color": "#hex", "position": 1.0, "opacity": 1 }
  ],
  "transform": [[a, b, tx], [c, d, ty]]
}
```

### Image Fill Shape

```json
{
  "type": "IMAGE",
  "scaleMode": "FILL | FIT | CROP | TILE",
  "imageHash": "abc123..."
}
```

### Text Properties

| Field | Location | Values | Notes |
|-------|----------|--------|-------|
| `characters` | root | string | The actual text content |
| `fontSize` | styles | number or `"mixed"` | Font size in px |
| `fontFamily` | styles | string or `"mixed"` | Font family name |
| `fontStyle` | styles | string or `"mixed"` | Font style (Regular, Bold, etc.) |
| `fontWeight` | styles | number or `"mixed"` | Numeric weight |
| `textDecoration` | styles | `UNDERLINE`, `STRIKETHROUGH` | Only when not NONE |
| `lineHeight` | styles | `{value, unit}` | Line height (unit: PIXELS or PERCENT) |
| `letterSpacing` | styles | `{value, unit}` | Letter spacing |
| `textAlignHorizontal` | styles | `LEFT`, `CENTER`, `RIGHT`, `JUSTIFIED` | Text alignment |
| `textAutoResize` | styles | `WIDTH_AND_HEIGHT`, `HEIGHT` | Only when not NONE |
| `maxLines` | styles | number | Only when > 0 |
| `textTruncation` | styles | `ENDING` | Only when not DISABLED |

### Mixed Text Segments

When a TEXT node has mixed fills, fonts, or weights, an additional `styledSegments` array is returned at the node root (sibling to `styles`). Only present when `styles.fills`, `fontFamily`, or `fontWeight` is `"mixed"`.

| Field | Location | Values | Notes |
|-------|----------|--------|-------|
| `styledSegments` | root (TEXT only) | array of segment objects | Per-character-range styles |

**Segment object shape:**

| Field | Type | Notes |
|-------|------|-------|
| `characters` | string | Text content of this segment |
| `start` / `end` | number | Character range (inclusive / exclusive) |
| `fill` | string | Hex color (`scan_text_nodes` output) |
| `fills` | array | Fill array (`get_node` / `get_design_context` output) |
| `fillStyleName` | string | Paint style token name (e.g. "Sematic/Warning/Orange 500") |
| `textStyleName` | string | Typography token name (e.g. "text 14px-small/bold") |
| `fontFamily` | string | Font family for this segment |
| `fontStyle` | string | Font style (Bold, Regular, etc.) |
| `fontWeight` | number | Numeric weight |
| `fontSize` | number | Font size in px |

**Usage:** When `styles.fills === "mixed"`, iterate `styledSegments` to extract per-range colors and font tokens. Each segment maps to an `AttributedString` range in implementation.

### Component Instance Fields

| Field | Location | Values | Notes |
|-------|----------|--------|-------|
| `componentName` | root | string | Component set name (or component name if not in set) |
| `componentProperties` | root | `{propName: {type, value}}` | Override values on this instance |

**componentProperties types:**
- `TEXT` — string value (label, placeholder, value)
- `BOOLEAN` — true/false (visible, checked, disabled)
- `INSTANCE_SWAP` — swapped child component name
- `VARIANT` — selected variant value

### Style Name Fields (from resolveStyleNames)

| Field | Location | Notes |
|-------|----------|-------|
| `fillStyleName` | styles | Figma paint style name |
| `strokeStyleName` | styles | Figma stroke style name |
| `textStyleName` | styles | Figma text style name |
| `effectStyleName` | styles | Figma effect style name |

---

## Section-Parallel Call Pattern

For large frames (height > 800px), use section-based parallel extraction:

```
Step 1: get_design_context(screenId, depth=1)
  -> Returns: Header (FRAME), Content (FRAME), Footer (FRAME)
  -> Filter: type === "FRAME" only

Step 2 (parallel):
  get_design_context(headerId, depth=2)     <- ~2K tokens
  get_design_context(contentId, depth=3)    <- ~3-4K tokens
  get_design_context(footerId, depth=2)     <- ~1-2K tokens

Step 3: Merge responses -> full screen tree
```

**Effective depth:** 1 (screen -> section) + 3 (section -> leaf) = 4 levels from root.
**Token efficiency:** ~6-8K total vs ~9K for depth=5 single call, with BETTER coverage.

---

## Tools NOT Needed for Spec Generation

| Tool | Why Skip |
|------|----------|
| `get_document` | Too large; get_design_context is targeted |
| `get_metadata` | File info already in get_design_context response |
| `get_selection` | Spec uses explicit nodeId, not selection |
| `get_viewport` | Irrelevant for spec extraction |
| `get_annotations` | Dev annotations, not design data |
| All write tools | Spec extraction is read-only |
