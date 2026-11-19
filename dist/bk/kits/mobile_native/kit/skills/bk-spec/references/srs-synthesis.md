# SRS Synthesis

Merge all gathered data into `{srs_dir}/*.md` files.

## Input Sources

| Source | Feeds Into |
|--------|-----------|
| Pre-flight collect | 01-overview (scope, stakeholders, priorities) |
| URD content | 01-overview, 02-functional, 03-nonfunctional |
| Figma (design specs) | 05-ui-ux-requirements |
| API spec | 04-api-contract |
| bk/docs/foundation/* | 01-overview (platform context) |

## Write Order (phase-separated)

**Phase 1 — SRS (from URD):**
1. `{srs_dir}/01-overview.md` — from `templates/01-srs-overview.md`
2. `{srs_dir}/02-functional-requirements.md` — from `templates/02-functional-requirements.md`
3. `{srs_dir}/03-nonfunctional-requirements.md` — from `templates/03-nonfunctional-requirements.md`

**Phase 2 — Design (from Figma):**
4. `{srs_dir}/05-ui-ux-requirements.md` — from `templates/05-ui-ux-requirements.md`

**Phase 3 — API (from API spec):**
5. `{srs_dir}/04-api-contract.md` — from `templates/04-api-contract.md`

## Quality Rules

- Tables for structured data
- MoSCoW priority on all requirements
- Cross-links: UC ↔ Screen ↔ Endpoint ↔ NFR
- Frontmatter on overview.md only
- "Not applicable" for sections without input data (never leave blank)
- Mermaid diagrams: max 20 nodes each, max 5 total
- Overview step (Step a) generates all diagrams
- Section writers embed diagrams from context, don't generate new

## Source Quality Tagging

| source_quality | Tagging rule |
|---------------|-------------|
| `verified` | Không tag đặc biệt |
| `medium` | Log warning trong 01-overview: "Không có URD — requirements suy luận từ API + Figma" |
| `low` | Source Quality Notice trong 01-overview + tag "(inferred — cần xác nhận)" cho acceptance criteria |
| `none` | Blocked by input gate (Pre-flight) — không đến synthesis |

## Phase-Input Mapping

| Phase | Input | Output | If missing |
|-------|-------|--------|------------|
| 1 SRS | URD | 01, 02, 03 | Gate → degraded nếu user chấp nhận |
| 2 Design | Figma URL | design/*/design.md, design/assets/, 05 | Skip toàn phase |
| 3 API | API spec | 04 | Skip toàn phase |
| 4 Validate | all outputs | spec-summary.md | Chạy luôn |

## Post-Synthesis

Present summary to user:

```
SRS generated for {feature-name} (srs_updated: {date})
├── {srs_dir}/01-overview.md                  — scope, {N} stakeholders, system context diagram
├── {srs_dir}/02-functional-requirements.md   — {N} use cases ({M} Must), {K} sequence diagrams
├── {srs_dir}/03-nonfunctional-requirements.md — {N} NFRs
├── {srs_dir}/05-ui-ux-requirements.md        — {N} screens, {M} flows, navigation diagram
└── {srs_dir}/04-api-contract.md              — {N} endpoints, {M} models, ER diagram
```
