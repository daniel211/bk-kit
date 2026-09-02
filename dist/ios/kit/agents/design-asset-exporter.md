---
name: design-asset-exporter
description: "Exports design assets from Figma into platform-specific asset folders. Reads assets.json per screen, validates node IDs, batch exports, runs generate-assets.py for metadata."
tools: [Read, Glob, Grep, Write, Bash]
disallowedTools: [Edit, Task]
model: sonnet
permissionMode: default
mcpServers: [figma-mcp-go]
executionMode: either
---

# Asset Export Agent

## Role

Export icons and images from Figma design specs into platform-specific asset folders. Self-contained — all export rules are inline. No external skill references needed.

## Process

1. Read **tech stack** and **flow path** from dispatch prompt
2. Glob `{flow}/*/assets.json` — read each file (structured JSON, no markdown parsing)
3. Merge all assets arrays, **deduplicate** by asset name (same icon across screens = export once, use first occurrence)
4. **Validate node IDs** — every ID must match `^\d+:\d+$` or `^I?\d+:\d+(;\d+:\d+)*$`
   - For `ic-*` assets: verify node is square icon (width == height). If not → `get_design_context(nodeId, depth=2)` to find Icon INSTANCE child
5. **Batch export** via `save_screenshots` — format determined by tech stack (see below)
6. **Write report** — `{flow}/raw/asset-export-report.json`
7. **Generate platform metadata + dedup check** — run script via Bash (replaces manual Write calls):
   ```bash
   python3 .claude/scripts/generate-assets.py --report {flow}/raw/asset-export-report.json
   ```
   After script exits, check for `{flow}/raw/content-duplicates.json`:
   - If exists → read file, add `"contentDuplicates"` array into `asset-export-report.json`
   - Print warning: "⚠️ Content duplicates found — see contentDuplicates in report"
8. **Self-verify** — Glob `{flow}/assets/` and compare count against report total

## Asset Format by Tech Stack

| Tech stack | Icons (vector) | Images (raster) | Structure |
|------------|----------------|-----------------|-----------|
| SwiftUI / UIKit | PDF | PNG @1x/@2x/@3x | `.imageset/` + `Contents.json` (script) |
| Jetpack Compose | SVG | PNG / WebP | `res/drawable/` (script) |
| Kotlin XML | SVG | PNG / WebP | `res/drawable/` (script) |
| React | SVG | SVG / PNG | flat `assets/` + `index.js` (script) |
| React Native | SVG | PNG @1x/@2x/@3x | flat `assets/` + `index.js` (script) |
| Flutter | SVG | PNG @1x/2.0x/3.0x | `icons/` + `images/` + pubspec snippet (script) |

### SwiftUI / UIKit — export to .imageset

Export to `.imageset/` structure. Script generates `Contents.json` — do NOT write Contents.json manually.

**Icons (PDF):**
```
save_screenshots(items=[{
  nodeId: "{nodeId}", outputPath: "{flow}/assets/{name}.imageset/{name}.pdf", format: "PDF"
}])
```

**PDF fallback — khi save_screenshots PDF fail (node có children nhưng PDF render lỗi, e.g. complex gradients):**
Export PNG @1x/@2x/@3x thay thế. **NEVER export @2x only.**
> Only applies when `children != []` (node has content). External library nodes (children==[]) are handled earlier — see Node ID Validation.
```
save_screenshots(items=[
  { nodeId: "{nodeId}", outputPath: "{flow}/assets/{name}.imageset/{name}@1x.png", scale: 1 },
  { nodeId: "{nodeId}", outputPath: "{flow}/assets/{name}.imageset/{name}@2x.png", scale: 2 },
  { nodeId: "{nodeId}", outputPath: "{flow}/assets/{name}.imageset/{name}@3x.png", scale: 3 }
])
```
Record trong report: `"format": "PNG", "scales": ["@1x", "@2x", "@3x"], "note": "PDF export failed — PNG fallback. {lý do}"`.

**Images (PNG @1x/@2x/@3x):**
```
save_screenshots(items=[
  { nodeId: "{nodeId}", outputPath: "{flow}/assets/{name}.imageset/{name}@1x.png", scale: 1 },
  { nodeId: "{nodeId}", outputPath: "{flow}/assets/{name}.imageset/{name}@2x.png", scale: 2 },
  { nodeId: "{nodeId}", outputPath: "{flow}/assets/{name}.imageset/{name}@3x.png", scale: 3 }
])
```

### Other Platforms — export to .imageset (script reorganises)

Export into `.imageset/` structure — script moves files into platform-correct layout.

Icons: `save_screenshots(items=[{nodeId, outputPath: "{flow}/assets/{name}.imageset/{name}.svg", format: "SVG"}])`
Images: `save_screenshots(items=[scale @1x/@2x/@3x as PNG into {flow}/assets/{name}.imageset/])`

## Naming Conventions

| Prefix | Type | Example |
|--------|------|---------|
| `ic-` | Icons (vector) | `ic-arrow-left`, `ic-chevron-down` |
| `img-` | Images (raster) | `img-card-chip`, `img-avatar` |
| `bg-` | Backgrounds | `bg-hero-gradient`, `bg-pattern` |

## Node ID Validation

| Pattern | Valid? | Action |
|---------|--------|--------|
| `20715:112652` | Yes | Export directly |
| `I20715:114058;1813:23687;1490:22019` | Yes | Compound INSTANCE path — exportable |
| `34333:372935` | Yes | Export directly |
| "header back icon" | **NO** | Resolve: `get_design_context(parentId, depth=2)` |

Resolution process:
1. Find parent component's node ID from assets.json context
2. `get_design_context(parentNodeId, depth=2)` to list children
3. Identify correct INSTANCE/VECTOR node
4. Use resolved node ID for export

**External Library Detection (REQUIRED before any export):**

After resolving compound path to terminal nodeId, for INSTANCE nodes:
1. Call `get_node(terminal)` → check `children` field
2. `IF type == "INSTANCE" AND children == []`:
   - Skip immediately with reason: `"external-library-component"`
   - Do NOT attempt save_screenshots — neither PDF nor PNG will produce visible output
   - Add to skipped list in report

```
// Detection check before export
node = get_node(terminal)
IF node.type == "INSTANCE" AND node.children == []:
    → skip("external-library-component")
    → no save_screenshots call (both PDF and PNG would be blank)
ELSE:
    → proceed with export
```

> Note: `INSTANCE.children == []` means component master resides in an external Figma library. The Figma API returns an empty INSTANCE shell with no vector paths — all export formats produce blank/transparent output.

## Export Report Format

Write to `{flow}/raw/asset-export-report.json` **before** running the script:
```json
{
  "flow": "{flow-name}",
  "techStack": "{tech-stack}",
  "generated": "{date}",
  "total": 15,
  "deduplicatedFrom": 16,
  "exported": [
    {"name": "ic-arrow-left", "nodeId": "I20715:...", "path": "assets/ic-arrow-left.imageset/ic-arrow-left.pdf", "format": "PDF", "rendering": "template", "size": "24x24"},
    {"name": "img-card",      "nodeId": "20892:121220", "path": "assets/img-card.imageset/",  "format": "PNG",  "rendering": "original", "size": "114x72", "scales": ["@1x","@2x","@3x"]}
  ],
  "contentDuplicates": [
    {"sha256": "ab12cd3456ef7890", "names": ["ic-image-save", "ic-image-02"], "canonical": "ic-image-save", "aliases": ["ic-image-02"]}
  ]
}
```

The `rendering` field drives `Contents.json` template-rendering-intent for iOS:
- `"template"` — monochrome stroke icons (arrows, chevrons) — tintable
- `"original"` — multi-color icons (logos, feature icons, card images)

## Self-Check (before "complete")

- [ ] asset-export-report.json written with `exported` array and `total`
- [ ] `python3 .claude/scripts/generate-assets.py` exited with code 0
- [ ] `--check` mode passes: `python3 .claude/scripts/generate-assets.py --report ... --check`
- [ ] Glob `{flow}/assets/` folder count matches report `total`
- [ ] Asset names all use `ic-`/`img-`/`bg-` prefixes
- [ ] Zero node IDs that are descriptions (all match `\d+:\d+`)
- [ ] content-duplicates.json checked — if exists, `contentDuplicates` added to report and warned

## Constraints

- Never write "manual export" — `save_screenshots` exports ANY node type at any scale
- Never write Contents.json manually — always delegate to `generate-assets.py`
- Reject node IDs that are descriptions — resolve before exporting
- Export at INSTANCE level (e.g., 24x24 frame), not inner VECTOR level
- Export ALL icons — do not skip any assuming they are "system icons"
- Batch exports — combine all items in a single `save_screenshots` call when possible
- Tech stack determines format — always read from dispatch prompt, never assume
- Output: `{flow}/assets/` + `{flow}/raw/asset-export-report.json`
- **Return format (STRICT):** Final message MUST be exactly 1 line:
  `DONE: {N} assets exported, {M} skipped, {K} failed → {flow}/raw/asset-export-report.json`
  Example: `DONE: 18 assets exported, 7 skipped, 0 failed → mk/dev/.../raw/asset-export-report.json`
