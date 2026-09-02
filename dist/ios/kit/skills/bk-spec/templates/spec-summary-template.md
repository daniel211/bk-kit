# Spec Summary Template

Write to `bk/dev/{feature-slug}/spec-summary.md` using this template. Replace all `{placeholders}` with actual values.

---

```markdown
# Spec Summary: {Feature Name}

> Generated: {date}
> Foundation: bk/docs/foundation/overview.md

## Input Sources

| Source | Path | Status | Quality Impact |
|--------|------|--------|---------------|
| URD | {path} | ✓ Validated / ⊘ Not provided | {if not provided: "All requirements INFERRED"} |
| Figma | {url} | ✓ Design extracted / ⊘ Not provided | {if not provided: "No UI/UX spec"} |
| API | {path} | ✓ Parsed / ⊘ Not provided | {if not provided: "API contract pending"} |

**Source Quality:** {source_quality} {degraded_mode ? "— User acknowledged degraded mode" : ""}

## SRS Documents

Generated at: `bk/dev/{feature-slug}/srs/`

| File | Content | Status |
|------|---------|--------|
| 01-overview.md | Scope, {N} stakeholders, system context diagram | ✓ |
| 02-functional-requirements.md | {N} use cases ({M} Must), {K} sequence diagrams | ✓ |
| 03-nonfunctional-requirements.md | {N} NFRs | ✓ |
| 04-api-contract.md | {N} endpoints, {M} models, ER diagram | ✓ / ⊘ No API input |
| 05-ui-ux-requirements.md | {N} screens, {M} flows, navigation diagram | ✓ / ⊘ No Figma input |

SRS quality review: `bk/dev/shared/reports/srs-review-{feature-slug}.md` — {OKAY / REVISE / N/A}
Design quality review: `bk/dev/shared/reports/design-review-{feature-slug}.md` — {OKAY / REVISE / N/A}
API quality review: `bk/dev/shared/reports/api-review-{feature-slug}.md` — {OKAY / REVISE / N/A}

## Design Summary

{If design.md exists: screen count, component count, token count}
{If not: "No design input provided"}

## Dependencies

{Cross-reference between SRS sections: which use cases map to which API endpoints, which screens}
- UC-001 → POST /api/payment (api-contract) → PaymentScreen (ui-ux-requirements)
- UC-002 → GET /api/merchant (api-contract) → MerchantInfoScreen (design.md)
{If no cross-refs possible: "Single-source inputs — no cross-dependencies detected"}

## Risks & Unknowns

{Issues discovered during extraction:}
- {e.g., "URD mentions OTP flow but no API endpoint found for OTP verification"}
- {e.g., "Figma design has 3 states not covered in SRS requirements"}
- {e.g., "Design extraction incomplete — Figma MCP timed out"}
{If none: "No risks identified"}

## Ready-for-Plan Checklist

- [x/!] Source quality: {source_quality} {degraded note}
- [x/] Phase 1 SRS — {N} use cases, {M} NFRs
- [x/] Phase 1 SRS quality review: {OKAY / N/A}
- [x/] Phase 2 Design (if Figma) — {N} screens, {M} components, 05-ui-ux
- [x/] Phase 2 Design quality review: {OKAY / N/A}
- [x/] Phase 3 API (if api_path) — {N} endpoints, {M} models
- [x/] Phase 3 API quality review: {OKAY / N/A}
- [x/] Cross-references verified (UC ↔ Screen ↔ Endpoint)
- [x/] Risks documented

## Next Step

Run: `/bk-plan {feature-slug}`
```
