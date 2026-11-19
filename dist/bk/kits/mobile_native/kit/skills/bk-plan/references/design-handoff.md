# Design Specs Handoff (bk-plan Step 4a — consumer only, NO dispatch)

Design extraction is owned by `/bk-spec` (which uses `design-validator`, `design-spec-writer`
and `design-asset-exporter` via the `figma` MCP). `/bk-plan` **consumes** existing outputs and
never re-extracts.

## Decision logic

```
has_figma_signal = (--figma flag OR Figma URL in description OR frame names in PRD/BRD)
has_ui_signal    = (bk/dev/{feature}/srs/05-ui-ux-requirements.md exists
                    OR UI keywords in description: screen, view, màn hình, giao diện, UI)

IF has_figma_signal OR has_ui_signal:
  spec_state = bk/dev/{feature}/.spec-state.json
  design_dir = bk/dev/{feature}/design/

  CASE: spec_state missing
    STOP. AskUserQuestion (Vietnamese):
      "Feature có signal về UI/Figma nhưng chưa chạy /bk-spec. Quay về extract design trước?"
      options:
        - "Quay về /bk-spec --design"  (Recommended) → halt /bk-plan, instruct user run /bk-spec
        - "Tiếp tục không có design"   → log gap in plan.md ## Gaps, skip 4a
  END

  CASE: spec_state exists, read state.design_review_verdict
    IF verdict == "OKAY":
      Glob design_dir + "*/design.md" → screens[]
      Write {plan-dir}/inputs/design-refs.json (pointer file, see schema below)
    ELSE IF verdict == "REVISE" OR state.design_partial set:
      Write design-refs.json with available screens + flag "verdict": "REVISE"
      Note in plan.md ## Gaps: "Design review verdict REVISE — extracted set is partial"
    ELSE IF state.design_cancelled:
      Log gap: "Design extraction was cancelled in /bk-spec — no design context"
      Skip 4a
    ELSE (verdict unknown / phase not reached / spec_state JSON unparseable):
      Treat as spec_state missing → use same AskUserQuestion as CASE above:
        "Spec design phase chưa hoàn tất. Quay về extract design trước?"
        options:
          - "Quay về /bk-spec --design"  (Recommended) → halt /bk-plan
          - "Tiếp tục không có design"   → log gap in plan.md ## Gaps, skip 4a
  END
ELSE (no Figma signal, no UI signal):
  Skip 4a entirely
```

Note: if `.spec-state.json` exists but is malformed/unparseable → treat as spec_state missing
(the "verdict unknown" branch).

## `inputs/design-refs.json` schema (pointer file, NOT a copy)

```json
{
  "source": "bk-spec",
  "feature_slug": "{feature}",
  "design_dir": "bk/dev/{feature}/design",
  "screens": [
    {"slug": "qr-scanner", "design_md": "bk/dev/{feature}/design/qr-scanner/design.md"}
  ],
  "ui_requirements": "bk/dev/{feature}/srs/05-ui-ux-requirements.md",
  "component_contracts": "bk/dev/{feature}/design/raw/component-contracts.json",
  "verdict": "OKAY|REVISE|partial|cancelled"
}
```

## Feeding design-refs.json into sub-task templates

- UI sub-tasks: `## Design Specs` section references screen `design.md` paths.
- Strings/tokens: dev agents read per-screen `design.md` + foundation `design-system.md`.
- Expected Code: design tokens are consumed at code-gen time, not in the plan.
