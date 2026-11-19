# Screen Extraction Workflow

Methodology to extract a **single Figma screen** into a 15-section design.md.

---

## Acquisition Strategy

Strategy depends on frame height.

### Large Frames (height > 800px) — Section-Based Parallel

1. `figma-cli nodes --ids {screenId} --depth 1` — identify top sections
2. **Filter:** keep only `type === "FRAME"` children (skip CONNECTOR, INSTANCE guides)
3. Parallel calls per section:
   - `figma-cli nodes --ids {headerId} --depth 2` — standard depth
   - `figma-cli nodes --ids {contentId} --depth 3` — deeper for main content
   - `figma-cli nodes --ids {footerId} --depth 2` — standard depth
4. Effective depth from screen root: 3-4 levels
5. Each call is small (~2-3K tokens), total ~6-8K

**DO NOT** fetch entire screen with depth=5 in a single call — section-parallel produces better coverage at lower token cost.

### Small Frames (height <= 800px) — Single Call

- `figma-cli nodes --ids {screenId} --depth 3` — ~5K tokens

---

## Processing

1. **Merge** section responses — full screen tree
2. **Component lookup:** for each INSTANCE node — lookup `raw/component-contracts.json` to identify standard vs custom components, props, states
3. **Token mapping:** see Token Mapping Protocol below
4. **Write** design.md (per design-md-format.md) + assets.json (structured asset list from Section 8 data, consumed by design-asset-exporter)
5. **Visual compare:** Read screenshot.png, verify each element is captured in design.md (see visual-compare.md)

---

## Token Mapping Protocol

Style names and design tokens come from `raw/styles.json` and `raw/variables.json`, which
`figma-cli screen` writes once per screen.

1. `raw/styles.json` — style ids resolved to names (paint, text, effect styles)
2. `raw/variables.json` — variable names + values per mode (absent without a Figma Enterprise plan)
3. For each node in `raw/node.json`:
   a. Read `fillStyleName` — slugify — `$primary-brand-500`
   b. Read `strokeStyleName` — slugify — `$neutral-gray-100`
   c. Read `textStyleName` — slugify — `$text-16-md-bold`
   d. Read `effectStyleName` — slugify — `$drop-shadow-sm`
   e. Read `boundVariables` — map variable ID to its name via `raw/variables.json`
4. Define in Design Tokens section: `$name` — hex — Figma style name
5. Reference `$name` everywhere else in Layout Tree, Component Breakdown
6. Values WITHOUT style name — hex + flag `⚠ no token`
7. For `styledSegments` on mixed TEXT nodes:
   a. Read `fillStyleName` per segment — slugify
   b. Read `textStyleName` per segment — slugify
   c. Document in Section 3 Component Breakdown (L10n Keys) as multi-style text with per-segment tokens

---

## Selective Deep-Dive

Standard components (skip — recognizable by INSTANCE name or component-contracts.json):
- Header app, Status Bar, Home Indicator, Button, Checkbox,
  Input field, Divider, Tab bar, KeyValue_mobile, Alert

Custom/unknown components (deep-dive):
- `figma-cli nodes --ids {nodeId} --depth 2` — ~0.5-1K tokens
- Max 3 deep-dives per screen to cap context growth
- If still insufficient — `figma-cli nodes --ids {nodeId}` with no `--depth` for the full tree

---

## Special Patterns

### INSTANCE Nodes with componentProperties

INSTANCE nodes expose:
- `componentName` — the component set name
- `componentProperties` — override values (TEXT, BOOLEAN, INSTANCE_SWAP, VARIANT)

Agent reads componentName + componentProperties directly:
- Text values (label, value, placeholder) available at INSTANCE level
- **DO NOT** deep-dive into standard components just to read text

### Invisible Interactive Components (Textlink, Link)

Some INSTANCE nodes have `componentName: "Button"` but NO visual fills/strokes (Type=Textlink, Type=Link).

**Rule:** Always check parent node type before describing a TEXT node:
- If TEXT's direct parent is INSTANCE with `componentName` containing "Button" → describe as `<Button Type={variant} label="{text}">`, NOT as `Text "{text}"`
- Key signal: `componentProperties` has `Type: "Textlink"` or `Type: "Link"`

### Overlay Pattern Detection

Figma popup/modal screens often use a **solid grey root frame** (`fills: ["#bdbdbd"]`) as a stand-in for a semi-transparent overlay.

**Detection rule:** When root frame has:
- `fills` = solid neutral grey (#bdbdbd or similar) with no opacity
- A single visible child component (sheet/modal) positioned at `y > 0`

**Document as:**
- Layout Tree: `fill=DIM_OVERLAY` (not `$gray-200`)
- Section 10: "Dim overlay: implement as semi-transparent black overlay (e.g. `.background(Color.black.opacity(0.4))`), not solid `#bdbdbd`"

### Icon Color Extraction

Icon INSTANCE nodes often have `fills: NO_FILLS` at the instance level. The actual rendered colors are in child VECTOR nodes.

**Rule:** For icon INSTANCEs (`componentName` containing "Icon", "icon", or status icons):
1. Report INSTANCE background fill (if any)
2. Drill into child VECTOR node and report strokes color
3. Use `figma-cli nodes --ids {iconId} --depth 2` to access VECTOR children

### Section 8 — Icon Node ID Depth

For `ic-*` assets in Section 8, the node ID must point to the **innermost Icon INSTANCE** (square: 24x24, 20x20, 48x48), not a parent action frame (wider: 80x24).

**Rule:** After recording a node ID for an `ic-*` asset, check its dimensions from the Layout Tree or `raw/node.json`. If `width != height` → drill deeper:
1. `figma-cli nodes --ids {nodeId} --depth 2` to list children
2. Find child with `type: "INSTANCE"` and name containing "Icon"
3. Use that child's compound ID in Section 8

```
BAD:  ;1490:22038           → _Action right (80×24 frame)
GOOD: ;1490:22038;1258:24060 → Icon/outline/reload (24×24 icon)
```

### Hidden Node Handling

- **Skip** nodes with `visible: false` in Layout Tree
- Optionally note in Component Breakdown: "Hidden states: Hint text (shows on validation error)"
- **Never** include hidden nodes in Screen Structure (ASCII wireframe)

### Scroll Auto-Detection

- If `frame.height > 844` (iPhone 14/15 viewport): annotate root container as `<- scrollable`
- Calculate overflow: `frame.height - 844 = N px` beyond viewport
- Note in design.md: "Scroll: {N}px below fold"

---

## Content Placement Rules

- Mixed-style text (`styledSegments`): document in Section 4 Localization Keys with note about mixed styles
- Form validation rules: document in the InputField component `#### States` (Error state trigger)
- Character limits: document as Optional Prop `maxLength` in the InputField component Props table

---

## OS-Provided Elements (Exclude from Spec)

Elements provided by the OS — do not include in Layout Tree, Component Breakdown, or Screen Structure.
Mention only if design overrides default appearance (e.g., light/dark status bar style).

| Element | Platform | Notes |
|---------|----------|-------|
| Home Indicator | iOS | System-drawn, no implementation needed |
| Status Bar | iOS/Android | Only note `style: light/dark` when relevant |
