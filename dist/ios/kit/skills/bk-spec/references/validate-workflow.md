# Validate, Summarize & Present

## Overview



## Workflow Steps

### Step 1: Validate Outputs

After all agents complete, verify:

| Check | Pass condition | Action if fail |
|-------|---------------|----------------|
| SRS | `srs/01-overview.md` exists AND `srs/02-functional-requirements.md` exists | Warn user, ask if proceed anyway |
| SRS quality | `mk/dev/shared/reports/srs-review-{slug}.md` verdict = OKAY | Warn + show issues to user |
| Design quality | `mk/dev/shared/reports/design-review-{slug}.md` verdict = OKAY | Warn + show issues to user |
| API quality | `mk/dev/shared/reports/api-review-{slug}.md` verdict = OKAY | Warn + show issues to user |
| Source quality | `source_quality` in `.spec-state.json` | If `low` + `degraded_mode`: add Risk "SRS degraded — requirements inferred, not verified against URD" |
| Design | `mk/dev/{feature-slug}/design/*/design.md` exists (≥1 screen) AND file size > 500 bytes | Warn + add to Risks |
| API | `srs/04-api-contract.md` exists | If missing: add Risk "API contract chưa có — chạy `/bk-spec --api` khi có spec" |

**Review report handling:**
- Report file does not exist (phase was skipped) → skip that check, do NOT fail
- Multiple conflicting verdicts (e.g. SRS OKAY, Design REVISE) → report each independently
- Record each verdict in spec-summary Ready-for-Plan Checklist

**Partial result strategy:** Phases are independent. Missing phase = documented gap, not blocker. Record in spec-summary Risks.

> **PHASE CHECKPOINT** — Validation failures
>
> Trigger: any check in the table above fails. STOP and AskUserQuestion before writing spec-summary.

When ANY check fails, present fail list to user via AskUserQuestion:
- **Tiếp tục với gaps** → record failures in spec-summary Risks, continue to Step 2
- **Quay lại sửa** → abort validate, return to relevant phase (SRS / Design / API)
- **Huỷ** → stop workflow without writing spec-summary

### Step 2: Write Spec Summary

Write `mk/dev/{feature-slug}/spec-summary.md` using the template from [spec-summary-template.md](../templates/spec-summary-template.md).

Key sections: Input Sources, **SRS Documents** (links to srs/ folder), Design Summary, Dependencies, Risks & Unknowns, Ready-for-Plan Checklist.

### Step 3: Present & Confirm

Show user:
1. Spec summary path
2. Validation results (pass/fail per check)
3. What's ready, what's missing
4. If `degraded_mode`: **⚠ DEGRADED MODE** warning
5. Suggest next step based on gaps

## PHASE CHECKPOINT — Final approval

> STOP: User approval required per CRITICAL BEHAVIORAL RULES #2. This is the final gate before /bk-plan handoff. DO NOT skip.

AskUserQuestion:
- **Chạy /bk-plan** → run `/bk-plan {feature-slug}`
- **Thêm Figma design** → return to Pre-flight with `--design` + preserved state
- **Thêm API spec** → return to Pre-flight with `--api` + preserved state

Options shown are contextual — only show "Thêm Figma design" if figma_url is null, "Thêm API spec" if api_path is null.

> **WORKFLOW CLEANUP** — End of Validate workflow
>
> Trigger: spec-summary.md đã viết xong và Final approval AskUserQuestion đã hiển thị (bất kể user chọn Chạy /bk-plan, Thêm Figma, Thêm API, hay Huỷ). Trước khi return về conductor (hoặc kết thúc skill bk-spec), MUST `TaskUpdate(status: "deleted")` cho từng task IDs đã tạo trong workflow này. TaskList phải về rỗng khi bk-spec kết thúc. Per SKILL.md rule #5.
