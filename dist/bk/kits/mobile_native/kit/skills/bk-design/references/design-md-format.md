# design.md Format

The design.md spec format has **9 sections**. Every design.md MUST include all 9 sections
(mark N/A where not applicable). This is the single source of truth for spec format.

## Design Principles

1. **Platform-agnostic** — spec dùng chung cho iOS, Android, Flutter, React Native. No platform syntax (no SwiftUI, no Compose, no Dart) in the spec.
2. **Data = pure design values** — dimensions, colors (hex + token), typography, spacing, states, interactions only. No code implementation.
3. **Localization keys** — every text string has a generic L10n key `{screen}.{element}`.

## Section Overview

```
1.  Screen Overview    (context, type, flow position, screen-level states)
2.  Layout             (ASCII wireframe, screen tree with h=, safe area, z-stack, grid)
3.  Component Breakdown (per-component: Anatomy → Variants → States → Props)
4.  Design Tokens      (colors, typography, gradients, effects, spacing, localization keys)
5.  States             (screen-level: loading/empty/error/success with skeleton specs)
6.  Interactions       (navigation, animations, sheet config, keyboard)
7.  Accessibility      (screen reader labels, touch targets, contrast, dynamic type)
8.  Assets             (export list, format notes, complex patterns)
9.  Visual Compare     (screenshot checklist — required; mark "Skipped (timeout)" if needed)
```

---

## Section Details

### 1. Screen Overview

Context, position in user flow, screen type, and screen-level states.

```markdown
## 1. Screen Overview

| Field | Value |
|-------|-------|
| Screen name | {name} |
| Screen type | Full screen / Bottom sheet / Popup overlay |
| Viewport | 375×812 |
| Scrollable | No — content fits viewport / Yes — {N}px below fold |
| Entry point | From screen {N} ({description}) |
| Exit points | Back → {N} \| {action} → {N} |
| Business context | {one-line description of business purpose} |

### Screen-level States
| State | Trigger | UI |
|-------|---------|-----|
| loading | {trigger} | {skeleton / spinner / dimmed} |
| empty | {trigger or N/A} | {empty view or N/A} |
| error | {trigger} | {toast / inline / N/A} |
| success | {trigger} | → Navigate to screen {N} |
```

**Rules:**
- Screen type determines Section 6.3 Sheet Config requirements (sheets/popups MUST have §6.3)
- Scrollable: derive from frame height vs viewport (> 844px → scrollable)
- Business context: one sentence, no tech jargon

---

### 2. Layout

Dimensions, ASCII wireframe, full screen tree with `h=` for every frame, safe area, z-stack, grid.

```markdown
## 2. Layout

### Screen Structure (ASCII wireframe)
```
┌────────────────────────────┐  375×54  StatusBar $color
│ [Status Bar]               │
├────────────────────────────┤  375×48  NavBar $color
│ [←]  Title                 │
├────────────────────────────┤  y=102
│  Content area              │
│                            │
│  [Button]                  │  y=727
├────────────────────────────┤  y=791
│ ─── Home Indicator ─────── │  375×21
└────────────────────────────┘
```

### Screen Layout Tree (h= bắt buộc cho MỌI frame)
```
Screen (375×812, $bg-color)
├── Header zone (375×102, y=0, fill=$brand-500)            // h=102
│   ├── StatusBar (375×54)                                 // h=54
│   └── NavBar (375×48)                                    // h=48
│       ├── ic-arrow-left (44×44 touch, icon 24×24)
│       └── title "Screen title" 16/Bold $white-500
│   // [safe-area] Header background extends behind top safe area
│
├── Content (375×{h}, y={y})                               // h={computed}
│   ├── Component A → see Section 3.N                      // h={from Figma}
│   └── Component B → see Section 3.N                      // h={from Figma}
│
└── Button / Footer (375×{h}, y={y})                       // h={h}, pinned
    // [safe-area] Pinned inside bottom safe area

// ZStack note (bottom → top) — only when layers overlap:
// Layer 0: $bg-color background (full 375×812)
// Layer 1: content stack
// Layer 2: overlay (gradient / modal backdrop)
```

### Viewport & Scroll
- Frame: {W}×{H} | Content height: {content_h}px
- Scroll: {Not needed / Yes — {N}px below fold (frame_h - 812)}

### Safe Area
| Zone | Strategy |
|------|----------|
| Header (y=0, h={N}) | {Background extends behind top safe area / Respects safe area} |
| Content (y={N}) | {Respects safe area — starts below nav bar} |
| Footer (y={N}) | {Pinned inside bottom safe area / Respects safe area} |

### Grid / Spacing
- Horizontal margin: {N}pt → usable width = {375-2N}pt
- {Other grid rules}

### Z-Stack ordering (bottom → top)
- Layer 0: {description}
- Layer 1: {description}
- *N/A — no overlapping layers on this screen* (only if verified)

### Presentation (sheets/popups only)
- N/A — full screen stack navigation
- OR: Modal sheet / Popup overlay / {details → see §6.3}
```

**Rules:**
- `h=` is MANDATORY for every frame, including HUG frames — read from `absoluteBoundingBox.height`
- ZStack ordering: only note when layers overlap at same y coordinates
- Safe area: behavioral description only — no platform-specific API syntax
- N/A for §2.5 Presentation only after verifying screen is full-screen

---

### 3. Component Breakdown

Each component as a numbered sub-section. Structure: Anatomy → Variants → States → Props.
Ends with Screen State Variables table.

```markdown
## 3. Component Breakdown

### 3.N ComponentName — {description} [{nodeId}]

> {One-line purpose of this component in this screen context}

#### Anatomy

```
{ASCII wireframe of component}
│  1. Part name    2. Part name  │  h={N}
└───────────────────────────────┘
3. Optional part
```

**Layout Tree**
```
ComponentName ({W}×{H}, h={H})
├── Part A ({W}×{H}, h={H}): {description}
│   └── Sub-element
└── Part B ({W}×{H}, h={H}): {description}
```

| # | Part | Required | Mô tả |
|---|------|----------|-------|
| 1 | {name} | Required/Optional | {description, including token} |
| 2 | {name} | Required/Optional | {description} |

#### Variants

##### {VariantName} ({label describing when used})

| Property | Value |
|----------|-------|
| **Mô tả** | {when to use this variant} |
| **Background** | {token} |
| **Text Color** | {token} |
| **Border** | {token width type / none} |
| **Border Radius** | {N}pt |
| **Shadow** | {token / none} |
| **Min Height** | {N}pt |
| {Other visual properties} | {value} |

```
{ASCII visual of this variant}
```

#### States

##### State Matrix

| State | {property} | {property} | Notes |
|-------|-----------|-----------|-------|
| **Default** | {value} | {value} | — |
| **Pressed** | {value} | {value} | ⚠ Inferred — {source} |
| **Disabled** | {value} | {value} | Trigger: {condition} |
| **Loading** | {value} | {value} | Trigger: {condition} |

##### State Transitions

| From → To | Duration | Easing | Properties |
|-----------|----------|--------|-----------|
| Default → Pressed | 0ms | — | {properties} |
| Pressed → Default | 100ms | standard | {properties} |

#### Props / API

##### Required Props

| Prop | Type | Default | Mô tả |
|------|------|---------|-------|
| `{prop}` | `{type}` | — | {description} |

##### Optional Props

| Prop | Type | Default | Mô tả |
|------|------|---------|-------|
| `{prop}` | `{type}` | `{default}` | {description} |

---

### Screen State Variables
| Variable | Type | Source | Default |
|----------|------|--------|---------|
| {varName} | {Type} | {User input / API response / Screen state / Injected from screen N} | {value} |
| isLoading | Bool | Screen state | false |
| isFormValid | Bool (computed) | {condition expression} | false |
```

**Rules:**
- Component section header: `### 3.N ComponentName — {description} [{nodeId}]`
- Anatomy: ALWAYS include Layout Tree with `h=` for every frame
- Variants: `##### VariantName (Label)` — include ASCII visual, no prefix "Visual:"
- States: inferred states MUST be marked `⚠ Inferred — {source}` with trigger condition
- Props: Required and Optional in separate tables
- State Variables: generic `Variable | Type | Source | Default` — no platform-specific syntax

---

### 4. Design Tokens

All visual values declared here; referenced as `$token` everywhere else.

```markdown
## 4. Design Tokens

### 4.1 Colors
| Token | Hex | Usage |
|-------|-----|-------|
| $brand-500 | #{hex} | {usage in this screen} |
| $white-500 | #ffffff | {usage} |

### 4.2 Typography
| Token | Font | Size | Weight | Line Height | Letter Spacing |
|-------|------|------|--------|------------|----------------|
| $text-16-semibold | {Font family} | 16 | 600 | {N}pt ({multiplier}×) | {N / 0} |

### 4.3 Gradients
| Token | Type | Angle | Stops (position%) |
|-------|------|-------|------------------|
| $gradient-{name} | linear | {N}° | $color@{N}% → $color@{N}% |

*N/A only after verifying no GRADIENT_* fills exist — do NOT write N/A by default.*

### 4.4 Effects (Shadows & Blur)
| Token | Element | Type | Color (hex) | Offset (x,y) | Blur | Spread |
|-------|---------|------|------------|-------------|------|--------|
| $shadow-{name} | {element} | drop_shadow | #{hex} | ({x}, {y}) | {N}pt | {N} |

*N/A only after scanning effects[] — do NOT write N/A by default.*

### 4.5 Spacing
| Token | Value | Usage |
|-------|-------|-------|
| $spacing-sm | {N}pt | {usage} |
| $radius-md | {N}pt | {usage} |
| $stroke-1 | 1pt (INSIDE) | {usage} |

### 4.6 Localization Keys
| Key | Default text |
|-----|-------------|
| `{screen}.{element}` | "{Vietnamese text}" |
```

**Rules:**
- Raw hex values ONLY in this section — `$token` references everywhere else
- Every `$token` referenced in Sections 2, 3 MUST be defined here
- Gradients: ALWAYS include angle° and stop positions% — never just "transparent to $color"
- Effects: scan `effects[]` array before writing N/A; if `effects` is non-empty → fill the table
- Flag values without Figma style: `⚠ no token` after hex
- L10n keys: format `{screen}.{element}`, one entry per visible text string

---

### 5. States

Screen-level states only. Component-level states live inside each component's `#### States` in Section 3.

```markdown
## 5. States

### Screen States
| State | Trigger | UI change |
|-------|---------|-----------|
| empty | Initial load | {what's visible — disabled buttons, empty fields} |
| filled | {condition} | {what changes} |
| loading | {action} → API in progress | {spinner / disabled inputs / dimmed content} |
| error | API failure | {toast / banner / inline error} |

### Skeleton Loading (if loading state shows skeleton)
- Row type: {RoundedRectangle shimmer, $gray-50 bg, cornerRadius=4}
- Row dimensions: {W}×{H} per row
- Row count: {N} rows

*Component-level states: see each Component section in Section 3.*
```

**Rules:**
- Section 5 = screen-level states ONLY (which components appear/disappear, which are disabled)
- Component states (exact colors, values, triggers) → in Section 3 `#### States`
- If no skeleton: mark loading state with spinner description only
- N/A for states that genuinely don't apply; do NOT mark N/A without evidence

---

### 6. Interactions

Navigation, animations, sheet/modal config, keyboard behavior.

```markdown
## 6. Interactions

### 6.1 Navigation
| Trigger | Action | Pattern |
|---------|--------|---------|
| Tap back arrow | Pop to screen {N} | Custom back button (hide system back) |
| Tap "{action}" (success) | {navigate/present} screen {N} | {Stack push / Modal sheet / etc.} |
| Swipe right | Pop to screen {N} | Edge swipe gesture |

### 6.2 Animations & Transitions
| Element | Animation | Duration | Curve |
|---------|-----------|----------|-------|
| Screen push | Slide from right | 0.35s | easeInOut |
| Sheet present | Slide from bottom | 0.3s | spring (damping=0.8) |
| Button press | Scale 1.0 → {N} | {N}s | easeOut |

### 6.3 Sheet / Modal Config (for sheets/popups — REQUIRED if Screen type is Sheet/Popup)
- Presentation: modal sheet slides from bottom
- Height: fixed {N}pt / dynamic (content-driven)
- Drag indicator: visible / hidden
- Background interaction: disabled (backdrop blocks parent) / enabled
- Backdrop: semi-transparent dark overlay (platform default)

### 6.4 Keyboard
- N/A — no input fields on this screen
- OR: Input "{label}": {keyboard type}; avoidance: {strategy}; auto-dismiss: {condition}
```

**Rules:**
- §6.3 is REQUIRED when Screen type = Bottom sheet or Popup overlay; mark N/A for full-screen only
- Animation durations: inferred from design system defaults if not in Figma prototype — mark ⚠ Inferred
- Keyboard avoidance: always specify if screen has text input

---

### 7. Accessibility

VoiceOver/TalkBack labels, touch targets, contrast, dynamic type.

```markdown
## 7. Accessibility

### 7.1 Screen Reader Labels
| Element | Label | Hint |
|---------|-------|------|
| Back button | "Quay lại" | "{context}" |
| Button "{label}" | "{label}" | "{what it does}" |
| Input "{label}" | "{label}, {value or placeholder}" | "{instruction}" |

### 7.2 Touch Targets
| Element | Visual size | Touch target | Status |
|---------|------------|-------------|--------|
| Back button | 24×24pt | 44×44pt (in nav bar) | ✅ |
| Button | {W}×{H}pt | {W}×{H}pt | ✅ / ⚠ Requires wrap |

### 7.3 Color Contrast
| Text / Background | Ratio | WCAG AA (4.5:1) |
|-------------------|-------|-----------------|
| $white-500 on $brand-500 | {N}:1 | ✅ Pass / ⚠ Fail |

### 7.4 Dynamic Type
- {Which labels support wrapping}
- {Which truncate with ellipsis}
- Button labels: single line, clip
```

**Rules:**
- Touch targets: min 44×44pt (Apple HIG) / 48×48dp (Material)
- Contrast ratios: derive from token hex values
- Mark ⚠ for contrast < 4.5:1 — note "design intent, ghi nhận" for placeholders

---

### 8. Assets

Icons and images requiring export. Exact node IDs only.

```markdown
## 8. Assets

### 8.1 Export List
| Name | Node ID | Format | Size | Rendering | Usage |
|------|---------|--------|------|-----------|-------|
| ic-{name} | I{nodeId};{...} | PDF | 24×24pt | template | {usage, tint: $token} |
| img-{name} | {nodeId} | PNG | {W}×{H}pt | original | {usage} |
```

**Rules:**
- Asset names: `ic-` (icons), `img-` (images), `bg-` (backgrounds) — NEVER `icon-` or `image-`
- Node ID MUST be the innermost square INSTANCE (24×24 or 20×20, width == height) — drill-down steps in extraction-workflow.md §Section 8
- **Overlay/Popup screens**: Section 8 Assets ONLY includes nodes owned by the TOPMOST sheet/popup container (identified in Section 2 Layout Tree as the visible modal frame). Background elements visible through the DIM overlay belong to the underlying full-screen — do NOT list them in assets.json for the overlay screen. If the popup owns no unique assets → Section 8 export list is empty (`[]`).

---

### 9. Visual Compare

Required section. Verify design.md against screenshot.png.

```markdown
## 9. Visual Compare

### Reference
- Figma node: `{nodeId}`
- Screenshot: `{flow}/{slug}/screenshot.png`
- Viewport: {W}×{H}

### Checklist
| # | Element | Expected | Pass? |
|---|---------|----------|-------|
| 1 | {element} | {expected value from spec} | ⬜ |
| 2 | {element} | {expected value} | ⬜ |
...

### Acceptance Criteria
- All {N} checklist items ✅ Pass
- No pixel-level layout shift > 2pt from Figma coordinates
- Colors within ±5% luminance of design tokens
```

**Rules:**
- Write this section AFTER completing all other sections and taking the screenshot
- If timeout: mark `**Status:** Skipped (timeout)` — do NOT omit the section entirely
- Checklist: 10-15 items covering header, key components, safe areas, colors, typography

---

## Anti-Patterns

- Raw hex in Layout Tree or Component Breakdown (violates Iron Law: hex only in §4)
- `h=` missing on any frame — even HUG frames must have height from Figma bounds
- "N/A" for §4.3 Gradients or §4.4 Effects without scanning Figma data first
- Omitting `#### States` from any interactive component (Button, InputField, ListItem)
- Component-level state values only in §5 (not inline in §3)
- ZStack ordering omitted when layers overlap at same y
- Safe area: platform syntax (`ignoresSafeArea`, `WindowInsets`) instead of behavioral description
- §6.3 Sheet Config missing for sheets/popups
- Text content not sourced from `characters` or `componentProperties` — especially Vietnamese diacritics
- Section 9 Visual Compare absent (even if skipped, must have "Skipped" entry)
- Leftover `{placeholder}` or `TODO` in design.md
- Generic phrases: "looks standard", "typical layout" without citing Figma data
