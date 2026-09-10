---
name: bk-spec
description: "Collect and validate feature inputs (URD, API docs, Figma) into a standardized spec package. Use when starting a new feature, preparing for /bk-plan, or when user says 'spec', 'prepare feature', 'collect requirements'."
user-invocable: true
argument-hint: "[--srs|--design|--validate] [--engine claude|agy|dual|auto] [feature-name] [urd-path] [figma-url]"
---

# Spec: $ARGUMENTS

Collect and validate all feature inputs (URD, API docs, Figma) into a standardized spec package ready for `/bk-plan`.

**Workflow position:** `bk-bootstrap → bk-spec → bk-plan → bk-code`

<Use_When>
- Starting a new feature that needs planning
- User has URD, API docs, and/or Figma designs to process
- Before running /bk-plan — this prepares the inputs
- User says "spec", "prepare feature", "collect requirements"
</Use_When>

<Do_Not_Use_When>
- Foundation missing — run /bk-bootstrap first
- Quick bug fix — use /bk-debug directly
- Already have spec-summary.md for this feature
- Feature-only code change with no new requirements
</Do_Not_Use_When>

## CRITICAL BEHAVIORAL RULES

You MUST follow these rules exactly. Violating any of them is a failure.

1. **Execute steps in order.** Do NOT skip ahead, reorder, or merge steps.
2. **Stop at checkpoints.** When you reach a `PHASE CHECKPOINT`, you MUST stop and wait for explicit user approval before continuing. Use the AskUserQuestion tool with clear options.
3. **Halt on failure.** If any step fails (agent error, test failure, missing dependency), STOP immediately. Present the error and ask the user how to proceed. Do NOT silently continue.
4. **Use only local agents.** All `subagent_type` references use agents bundled with this plugin or `general-purpose`. No cross-plugin dependencies.
5. **TaskList scope = workflow đang chạy.** Có hai mặt creation và cleanup, cả hai đều bắt buộc:
   - **Creation (khi vào workflow):** `TaskCreate` CHỈ được gọi cho các step thuộc workflow conductor vừa bước vào (xem `## Task Tracking` của workflow file đang load). CẤM pre-create task cho workflow tương lai (ví dụ đang SRS không được tạo task của Design/Validate). Roadmap tổng thuộc về `.spec-state.json` + `phase_history`, KHÔNG thuộc TaskList. Conductor đi vào workflow mới → mới `TaskCreate` của workflow đó. Vi phạm = TaskList nhiễu, user thấy cả pipeline thay vì workflow hiện tại.
   - **Cleanup (khi kết thúc workflow):** Khi gặp block `WORKFLOW CLEANUP` ở cuối workflow file, BẮT BUỘC `TaskUpdate(status: "deleted")` cho TẤT CẢ task đã tạo trong workflow đó (conductor track IDs từ các `TaskCreate` ở `## Task Tracking`) TRƯỚC KHI return về conductor để enter workflow tiếp theo. Sau compaction nếu mất context IDs, conductor có thể an toàn `TaskList` rồi delete tất cả — vì workflow trước đã cleanup, TaskList chỉ còn task của workflow hiện tại. Persistent layer là `.spec-state.json` + output files; TaskList chỉ phản ánh workflow đang chạy.
   - KHÔNG động đến task của skill khác (bk-debug, bk-code) — track IDs chặt chẽ.


## Smart Intent Detection

Detect feature + operation từ `$ARGUMENTS` và existing spec state. Interview user CHỈ khi signals ambiguous.

| Input Pattern | Detected Operation | Behavior |
|---------------|-------------------|----------|
| `--srs` flag OR URD path (.md/.txt) | `srs` | Generate SRS from URD |
| `--design` flag OR figma.com URL | `design` | Extract design spec from Figma |
| `--api` flag OR OpenAPI file (.yaml/.json) | `api` | Parse API contract |
| `--validate` flag OR all outputs exist | `validate` | Verify spec package + summary |
| Feature name matches existing incomplete spec | `resume` | Continue last phase từ `.spec-state.json` |
| 2+ inputs (URD + Figma + API combos) | `full` | Run Phase 1 → 2 → 3 → 4 |
| No inputs OR no feature OR ambiguous signals | `interview` | AskUserQuestion fallback (default) |
| `--engine claude\|agy\|dual\|auto` | *(modifier)* | Design extraction engine, Phase 2 only. Default `auto`: agy when this machine can run it, claude otherwise. See `references/design-workflow.md` §Engine Selection |

**Foundation precondition:** `bk/docs/foundation/overview.md` must exist. Missing → abort, ask user to run `/bk-bootstrap`.

**Conflict resolution:** Explicit subcommand flag > existing state (resume) > multi-input > single input > interview.

Load: `references/intent-detection.md` for detection algorithm (pseudo-code), feature resolution, source quality gate, state persistence.

## Subcommand Routing

After Smart Intent Detection resolves `operation`, load the corresponding phase reference:

| Operation | Phase Reference | Phases to Run |
|-----------|----------------|---------------|
| `srs` | `references/srs-workflow.md` | Phase 1 |
| `design` | `references/design-workflow.md` | Phase 2 |
| `api` | `references/api-workflow.md` | Phase 3 |
| `validate` | `references/validate-workflow.md` | Phase 4 |
| `full` | All four workflows | Phase 1 → 2 → 3 → 4 |
| `resume` | Workflow matching `state.current_phase` | Continue from saved phase |
| `interview` | `references/intent-detection.md` (Interview section) | AskUserQuestion → re-detect |


## Workflow Process

### Phase 1: SRS (if URD provided or degraded accepted)
Load: `references/srs-workflow.md`
bk-docs-writer ×3 (overview → functional → non-functional, all foreground) + bk-code-reviewer quality review.

### Phase 2: Design (if Figma URL provided)
Load: `references/design-workflow.md`
design-validator → approval gate → design-spec-writer ×N → asset-exporter → **05-ui-ux-requirements** → **design quality review**.

### Phase 3: API (if api_path provided)
Load: `references/api-workflow.md`
bk-docs-writer (parse API spec → 04-api-contract.md) → **API quality review**.

### Phase 4: Validate
Load: `references/validate-workflow.md`
Verify outputs → write spec-summary.md → present results.
**MANDATORY:** AskUserQuestion with options: **Proceed to plan** / **Review spec** / **Add more inputs**. Do NOT skip this gate.


## Output Requirements

| Output | Path | Condition |
|--------|------|-----------|
| Task state | `bk/dev/{feature-slug}/.spec-state.json` | Always (created during Intent Detection, updated every phase) |
| Spec summary | `bk/dev/{feature-slug}/spec-summary.md` | Always |
| SRS Overview | `bk/dev/{feature-slug}/srs/01-overview.md` | Phase 1: If URD or degraded accepted |
| SRS Functional Reqs | `bk/dev/{feature-slug}/srs/02-functional-requirements.md` | Phase 1: If URD or degraded accepted |
| SRS Non-Functional Reqs | `bk/dev/{feature-slug}/srs/03-nonfunctional-requirements.md` | Phase 1: If URD or degraded accepted |
| SRS API Contract | `bk/dev/{feature-slug}/srs/04-api-contract.md` | Phase 3: Only if api_path provided |
| SRS UI/UX | `bk/dev/{feature-slug}/srs/05-ui-ux-requirements.md` | Phase 2: After design extraction |
| Design spec | `bk/dev/{feature-slug}/design/` | Phase 2: If Figma provided |

## Step Output Format

```
✓ Step [N]: [Brief status] - [Key metrics]
```