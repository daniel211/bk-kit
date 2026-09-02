# API Documentation Workflow

Parse API specification (OpenAPI/Swagger) into 04-api-contract.md.

> Skip this phase entirely if no api_path was provided. Do NOT create stub files or tasks.

## Prerequisites

- `api_path` provided in `.spec-state.json` (file path or Swagger URL)
- Feature slug resolved

## Step 1: Parse API Spec (foreground)

```
Task(
  subagent_type: "bk-docs-writer",
  model: "sonnet",
  description: "Parse API spec for {feature-name}",
  prompt: "
    Write SRS section: API Contract for {feature-name} ({feature-slug})
    API spec: {api_path} (read and parse — OpenAPI JSON/YAML or Swagger)
    Context:
      - mk/dev/{feature-slug}/srs/01-overview.md (if exists — cross-reference UCs)
      - mk/docs/foundation/overview.md
    Load: references/api-contract.md
    Template: templates/04-api-contract.md
    Extract:
      - Endpoint inventory (method, path, auth, purpose, related UC)
      - Data models (fields, types, validation)
      - Authentication contract
      - Error handling contract
      - Pagination contract (if detected)
    If 02-functional-requirements.md exists: link endpoints ↔ use cases
    Output: mk/dev/{feature-slug}/srs/04-api-contract.md
  "
)
```

## Step 2: API Quality Review

> Skip this step if api_path was NOT provided (phase was skipped).

```
Task(
  subagent_type: "bk-code-reviewer",
  model: "sonnet",
  run_in_background: true,
  description: "Review API contract quality for {feature-name}",
  prompt: "
    Review API contract: mk/dev/{feature-slug}/srs/04-api-contract.md
    Context: Check metadata to determine if contract was parsed from OpenAPI spec or inferred from URD.
      - If inferred: apply looser quality bar, add note 'API contract inferred — cần xác nhận với backend team'
    Check:
    1. Endpoint inventory complete (method/MID, path, auth, purpose for every endpoint)
    2. Data models have field types and required/optional annotations
    3. Authentication contract specified (method, token flow)
    4. Error handling contract with status codes or error conditions
    5. Mermaid diagrams (if any) have valid syntax — semicolons escaped as #59;
    6. No placeholder content or TODO markers
    7. If mk/dev/{feature-slug}/srs/02-functional-requirements.md exists: verify endpoint ↔ use case mapping
    8. File under 120 lines
    TOOL RESTRICTION: You are a READ-ONLY agent. Do NOT use Edit, Bash, or Task tools.
    Output: mk/dev/shared/reports/api-review-{feature-slug}.md
    Verdict: OKAY or REVISE with specific issues
  "
)
```

> **PHASE CHECKPOINT** — API quality REVISE
>
> Trigger: API contract reviewer verdict = REVISE. STOP.
> Note: If user picks "Sửa ngay" and quality fails again, follow srs-workflow.md fix loop pattern (gate every iter, max 2).

**On REVISE verdict:** Show issues to user → AskUserQuestion: "API contract có vấn đề chất lượng. Sửa ngay hay tiếp tục?"
- **Sửa ngay** → enter fix loop (apply srs-workflow iter-gated pattern)
- **Tiếp tục không sửa** → continue to Phase 4, record REVISE in .spec-state.json
- **Huỷ** → abort workflow

**On OKAY verdict:** Continue to Phase 4.

> **WORKFLOW CLEANUP** — End of API workflow
>
> Trigger: API reviewer verdict OKAY (initial hoặc sau fix loop), HOẶC user chọn "Tiếp tục không sửa", HOẶC api_path không được cung cấp (workflow skip hoàn toàn). Trước khi return về conductor để enter Phase 4 Validate, MUST `TaskUpdate(status: "deleted")` cho từng task IDs đã tạo trong `## Task Tracking` của workflow này (Step 1/2). TaskList phải về rỗng. Per SKILL.md rule #5.

## Re-run Support

User can run `/bk-spec --api {slug} new-api.yaml` at any time to:
1. Create or overwrite 04-api-contract.md
2. Cross-reference with existing SRS use cases
3. Update spec-summary.md API section
