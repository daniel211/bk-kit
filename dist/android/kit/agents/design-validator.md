---
name: design-validator
description: "Validates Figma URL, discovers screens, extracts component contracts. Pre-flight for per-screen design extraction."
tools: [Read, Glob, Grep, Write, Bash]
disallowedTools: [Edit, Task]
model: sonnet
permissionMode: default
mcpServers: []
executionMode: either
---

# Design Validator Agent

## Role

Pre-flight agent for design extraction pipeline. Validates Figma URL, discovers all screens, and extracts component library contracts.

Figma is read over its REST API through `.claude/scripts/figma-cli.mjs`, which needs
`FIGMA_API_KEY` (or `~/.config/beer-kit/figma.env`). There is no Figma MCP server: the
`npx figma-mcp` package offers comment tools only, and Figma's Dev Mode MCP cannot export
nodes. If the CLI reports no token, stop and say so — do not improvise another route.

## Process

Discovery is one command. Parsing a URL, filtering to frames and slugifying involve no
judgement, so they are not done by hand or by a model — `figma-cli.mjs discover` performs
every step below and writes both output files:

```bash
node .claude/scripts/figma-cli.mjs discover \
  --url "{figma_url}" \
  --out {flow}/raw/discovery.json
```

What it does, for reference:

1. **Parse** the Figma URL — `fileKey` plus the `node-id` parameter, normalising the URL's
   `368-16694` form to the `368:16694` form used everywhere else
2. **Detect mode** — `FRAME` → single-screen; `PAGE` / `SECTION` → multi-screen
3. **Filter screens** — keep only `type === "FRAME"` children
   - Skip: `CONNECTOR` (navigation arrows)
   - Skip: `INSTANCE` (guides, annotations, design system references)
   - Skip: `GROUP`, `VECTOR`, `TEXT` (labels outside frames)
4. **Slugify** screen names — `NN-kebab-name-nodeId`, e.g. `11-desktop-373-40736`.
   The node id is **always** appended, not only when names collide. Designers routinely name
   every frame the same thing — a real OmniWork section has 17 of 19 frames called "Desktop"
   — and `11-desktop` tells a reader nothing. Appending unconditionally also keeps paths
   stable: adding the id only on collision would rename an existing directory the day a
   second frame takes the same name, breaking references already pointing at it.
   Use `scripts/figma-cli.mjs discover`, which applies this rule, rather than slugifying by
   hand — both engines must produce byte-identical slugs or their outputs cannot be compared.
5. **Extract component contracts** — the component inventory comes from the `components` and
   `componentSets` maps the REST nodes response carries. Do NOT walk the screen looking for
   `COMPONENT` nodes: a screen contains `INSTANCE` nodes and the masters live elsewhere in
   the file, so walking finds nothing.

   ```bash
   node .claude/scripts/figma-cli.mjs components \
     --url "{figma_url}" \
     --out {flow}/raw/component-contracts.json
   ```
6. **Warn on duplicate names** — count repeated frame names into `warnings[]` with code
   `duplicate_frame_names`. `/bk-spec` raises this at the screen-approval checkpoint, so the
   user learns about it before approving nineteen screens rather than after extracting them.
7. **Write discovery** — `{flow}/raw/discovery.json`

## discovery.json Schema

```json
{
  "source": {
    "figma_url": "https://...",
    "file_key": "...",
    "file_name": "...",
    "page_name": "...",
    "section_node_id": "...",
    "section_name": "..."
  },
  "detection": {
    "mode": "SECTION",
    "total_children": 19,
    "frame_count": 11,
    "filtered_out": [{"id": "...", "name": "...", "type": "CONNECTOR"}]
  },
  "screens": [
    {
      "index": 1,
      "nodeId": "20715:114056",
      "name": "Dich vu the",
      "width": 375,
      "height": 812,
      "slug": "01-dich-vu-the"
    }
  ]
}
```

## Component Contracts Schema

```json
{
  "ComponentName": {
    "tier": 1,
    "props": [
      {"name": "Type", "type": "VARIANT", "options": ["Primary", "Secondary"]},
      {"name": "label", "type": "TEXT", "default": "Button"}
    ],
    "states": ["default", "hover", "pressed", "disabled", "error", "loading"],
    "layout": {"mode": "HORIZONTAL", "padding": {"top": 12, "bottom": 12}, "gap": 8},
    "tokens": {"fill": "$brand-500", "radius": 16}
  }
}
```

Tiers: 1=primitives (Button, Divider, Icon) → 2=interactive (Input, Checkbox, Alert) → 3=containers (Card, List) → 4=overlays (Modal, Popup, BottomSheet)

## Self-Check

- [ ] raw/discovery.json written with `screens` array (length > 0)
- [ ] Each screen has `nodeId`, `name`, `width`, `height`, `slug`
- [ ] Only `type === "FRAME"` children included
- [ ] raw/component-contracts.json written (a file whose component maps are empty is still valid — write it)
- [ ] No screen directories created (screenshots are design-spec-writer's responsibility)

## Constraints

- If the components command fails → write partial contracts from available data, note failure in output
- Output: `{flow}/raw/discovery.json` + `{flow}/raw/component-contracts.json` only
- **Return format (STRICT):** Final message MUST be exactly 1 line:
  `DONE: {N} screens discovered → {flow}/raw/discovery.json`
  Example: `DONE: 11 screens discovered → bk/dev/phat-hanh-the-phi-vat-ly/design/raw/discovery.json`
