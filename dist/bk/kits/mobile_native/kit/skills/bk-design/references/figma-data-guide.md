# Figma Data Guide

How the design pipeline reads Figma, and what the data looks like when it arrives.
Single source of truth for both engines: `claude` and `agy` read the same files.

## There is no Figma MCP server

The pipeline calls Figma's REST API through `.claude/scripts/figma-cli.mjs`. Two MCP servers
exist and neither works for this:

| Server | What it offers | Why not |
|--------|----------------|---------|
| `npx figma-mcp` | add_figma_file, post_comment, read_comments, reply_to_comment, view_node | Comment tooling. Extracts nothing. |
| Figma Dev Mode MCP | get_design_context, get_metadata, get_screenshot, get_variable_defs | No node export, so no screenshots to disk and no assets. |

An older `figma-mcp-go` server is referenced in this kit's history. It is installed nowhere
and has no recorded install path. Its documented response fields are Figma REST fields
verbatim, so it was a wrapper over this API — which is what the CLI now calls directly.

**Requires** `FIGMA_API_KEY`, or the token in `~/.config/beer-kit/figma.env` or a project
`.env`. Run `bk doctor` to check.

## Commands

| Need | Command |
|------|---------|
| Discover screens from a URL | `figma-cli discover --url "{url}" --out {flow}/raw/discovery.json` |
| Everything for one screen | `figma-cli screen --file {key} --ids {nodeId} --out-dir {flow}/{slug}/raw` |
| Go deeper into one branch | `figma-cli nodes --file {key} --ids {id} --depth 3` |
| Text only | `figma-cli text --file {key} --ids {id}` |
| Component inventory | `figma-cli components --url "{url}"` |
| Design tokens | `figma-cli variables --file {key}` |
| Style names | `figma-cli styles --file {key}` |
| Screenshot to disk | `figma-cli export --file {key} --ids {id} --format png --scale 2 --out-dir {dir} --name screenshot` |
| Icon export (vector) | `figma-cli export --format pdf` (iOS) or `--format svg` |
| Image export (raster) | `figma-cli export --format png --scale 1\|2\|3` |

## What `screen` writes

| File | Contents | Depth |
|------|----------|-------|
| `node.json` | Node tree, pruned to the fields below | Limited (default 6) |
| `text.json` | Every TEXT node with `characters` verbatim | Full |
| `components.json` | Component masters, sets, and the instances on this screen | Full |
| `styles.json` | Style ids resolved to names | — |
| `variables.json` | Design tokens with modes, when available | — |
| `asset-candidates.json` | Every icon/image node, with size and squareness | Full |

**`node.json` is depth-limited and this matters.** One real screen serialises to 3.1 MB
unpruned; six levels brings it to 82 KB. Assets sit below that limit, which is why
`asset-candidates.json` exists and is walked at full depth — a spec written from `node.json`
alone lists no assets at all. A node cut off by the limit carries `childrenTruncated: N`
rather than passing for a leaf; when a section needs what was cut, fetch that branch with
`figma-cli nodes --ids {childId}`.

## Caching and rate limits

Responses are cached on disk under the Figma file's own `version`, at
`~/.cache/beer-kit/figma/{fileKey}/` (`XDG_CACHE_HOME` is honoured). Every command starts
with one `GET /files/{key}?depth=1` to read that version; edit the file in Figma and the
version moves, so nothing written under the old one can be served. Re-running a flow over an
unchanged file therefore costs that one small call instead of refetching every screen.

- Force a fresh read: `--no-cache`, or `BK_FIGMA_NO_CACHE=1` (the env var also covers the
  `agy` engine, which has no flags).
- Rendered image URLs are **never** cached — Figma expires them, so a cached link would be
  dead on arrival. `export` skips the version probe entirely.
- Entries older than 7 days are swept automatically.
- If the version probe fails, the cache is silently disabled and everything is fetched. A
  design is never served stale to save a request.

`429` and `5xx` are retried three times with exponential backoff, honouring `Retry-After`
when Figma sends it (capped at 30s per wait). `401`/`403`/`404` fail immediately — they
answer the same way however often they are asked, so retrying one only delays the error you
need to read.

## Two limits worth knowing before you start

**Variables need Enterprise.** `figma-cli variables` returns 403 without the
`file_variables:read` scope and a Figma Enterprise plan. That is a normal state: design
tokens then come from `styles.json` names and the raw values in `node.json`. Say so in
Section 4 rather than inventing token names.

**A screen holds instances, not components.** Component masters live elsewhere in the file,
so walking a screen for `COMPONENT` nodes finds nothing. The inventory comes from the maps
the REST response carries, which `components.json` already contains.

---

## Serializer Fields Reference

Fields present in `raw/node.json` after `figma-cli` prunes the REST response. The names are
Figma's own — this table is the contract between the API and the spec.

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


## Fetching a large screen in parts

For frames over ~800px, fetch section by section rather than pulling the whole tree deep:

```
1. figma-cli nodes --ids {screenId} --depth 1    → Header, Content, Footer (FRAME only)
2. figma-cli nodes --ids {headerId}  --depth 2
   figma-cli nodes --ids {contentId} --depth 3
   figma-cli nodes --ids {footerId}  --depth 2
3. Merge → the full screen tree
```

Effective depth 1 + 3 = four levels from the root, at a fraction of the payload of one deep
call, with better coverage of the parts that matter.

## Not needed for spec generation

| Endpoint | Why skip |
|----------|----------|
| `GET /files/:key` (whole file) | Enormous; the nodes endpoint is targeted. Only `?depth=1` is used, to read the file version for the cache |
| Comments API | Dev annotations, not design data |
| Any write endpoint | Spec extraction is read-only |
