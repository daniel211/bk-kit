# Design-First Gate — Detail (bk-code-workflow)

The gate itself is BLOCKING and lives in SKILL.md. This file holds the lookup detail.

## 1. Primary path (canonical — `/bk-spec` output)

- Glob `bk/dev/{feature}/design/*/design.md` (per-screen specs from `design-spec-writer`)
- Read `bk/dev/{feature}/.spec-state.json` → check `design_review_verdict`
- If at least one `design.md` exists for the current task's screen:
  - `verdict == "OKAY"` → read the screen `design.md` + `bk/docs/foundation/design-system.md`
    for tokens, then proceed
  - `verdict == "REVISE"` or `design_partial` set → proceed with a warning, and add
    `design_verdict: REVISE` to the impl report frontmatter
  - `design_cancelled` → fall through to the legacy fallback

## 2. Legacy fallback

Backward compat for features built before the `/bk-spec` migration — TODO: remove after the v2.x
sunset, see plan `260511-1447-remove-bk-design-agent-consolidate-to-spec`.

- Check `bk/dev/shared/design/{feature}-specs.md` and `{feature}-tokens.json`
- Both exist → read them + log the warning "DEPRECATED design path — migrate to /bk-spec", proceed

## 3. Inline guidance fallback

Task prompt contains design details (colors, sizes, layout described inline) → proceed, and add
`design_specs_missing: true` to the impl report frontmatter.

## 4. No specs anywhere

Return the error: `"Design specs required. Run /bk-spec --design first to extract Figma specs for
this feature."`

## Design Token Validation

After loading design context, validate completeness:

1. **Foundation check:** `bk/docs/foundation/design-system.md` exists (global tokens, source of truth)
2. **Per-screen check:** the current task screen's `design.md` has a `## Design Tokens` section
   (or references foundation)
3. **Consistency check:** color values are valid hex; spacing values are numeric

If validation fails — per-screen `design.md` missing for the current task screen → warn the
conductor: "Design spec missing for screen {slug}". The conductor then decides:
- proceed with inline guidance + `design_specs_missing: true` in the impl report, or
- AskUserQuestion: "Quay về /bk-spec --design để extract screen {slug}?"
