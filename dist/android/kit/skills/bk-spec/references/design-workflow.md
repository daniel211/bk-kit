# Design Documentation Workflow

> Skip this phase if no Figma URL was provided.

## Overview

Extract design specs from Figma screens and generate UI/UX requirements documentation.
Steps 1–5 run sequentially. Step 2 dispatches screen extractions in parallel.

## Retry Policy

Centralized retry budgets — referenced by individual steps:

| Step | Max retries | Failure action |
|------|------------|----------------|
| Step 1 (Discovery) | 1 | After 1 retry: escalate to user (likely invalid Figma URL or permission) |
| Step 2 (Per-screen) | 2 per screen | After 2 retries: enter Partial Success Gate (see Step 2 post-verify) |
| Step 3 (Asset export) | 1 | After 1 retry: continue with warning, log to `.spec-state.json` |
| Step 5 (Review fix loop) | 2 iterations | After 2 iterations: enter Final Phase Checkpoint (see Step 5) |

## Task Tracking

Create tasks upfront with dependencies, then update status as each step executes. **Screen count is unknown upfront** — Step 2 starts with placeholder text and gets hydrated after the Phase Checkpoint.

```
TaskCreate(subject: "Step 1: Figma discovery", activeForm: "Discovering Figma screens...")
TaskCreate(subject: "Step 2: Design spec extraction", activeForm: "Waiting for screen approval...", blockedBy: [Step 1])
TaskCreate(subject: "Step 3: Asset export", activeForm: "Exporting assets...", blockedBy: [Step 2])
TaskCreate(subject: "Step 4: UI/UX requirements", activeForm: "Writing UI/UX requirements...", blockedBy: [Step 2])
TaskCreate(subject: "Step 5: Design quality review", activeForm: "Reviewing design quality...", blockedBy: [Step 3, Step 4])
```

Before each step: `TaskUpdate(status: "in_progress")`. After: `TaskUpdate(status: "completed")`.

**Note:** Step 2 task is created upfront with placeholder subject. After the Phase Checkpoint, it gets hydrated with the actual approved screen count and slug list — see §Hydrating Step 2 after Phase Checkpoint below.

Do NOT create per-screen sub-tasks. Step 2 remains a single task throughout. Per-screen progress is tracked via metadata updates and filesystem post-verify (see Step 2 instructions).

## Workflow Steps

### Step 1: Figma Discovery

Dispatch design-validator to discover screens:

```
Task(
  subagent_type: "design-validator",
  model: "sonnet",
  description: "Figma discovery",
  prompt: "Figma URL: {figma_url}
    Flow: bk/dev/{feature-slug}/design/
    Task: Parse URL, discover screens, extract component contracts.
  "
)
```

**Verify** `bk/dev/{feature-slug}/design/raw/discovery.json` + `raw/component-contracts.json` exist.

| Condition | Action |
|-----------|--------|
| Both files exist | `TaskUpdate(<Step1>, status: "completed")` → proceed to Phase Checkpoint |
| `discovery.json` missing | Per Retry Policy: 1 retry of design-validator. After retry, escalate via AskUserQuestion: *"Discovery thất bại. Cập nhật Figma URL hay huỷ?"* — Cập nhật → re-dispatch with new URL. Huỷ → trigger Cancel Handling. |
| `component-contracts.json` missing | Non-fatal (some Figma files have no component instances). Log warning to `.spec-state.json` (`component_contracts_missing: true`). Continue. |

On successful verify: `TaskUpdate(<Step1>, status: "completed")` BEFORE presenting the Phase Checkpoint. The gate is a separate user interaction, not part of Step 1's work.

### Phase Checkpoint: Step 1 Screen Approval

> **PHASE CHECKPOINT** — Step 1 Screen Approval
>
> Trigger: Step 1 verify successful. STOP. Present screen list to the user via AskUserQuestion before proceeding to Step 2.

Display a summary list and ask:

```
Có tất cả N màn hình. Hãy review và lựa chọn bước tiếp theo

1. "Approve tất cả N màn hình" (Recommended) → approved = all N screens
2. "Chọn màn hình cụ thể" → present multi-select in batches of 4 per question (if N > 16, multiple sequential questions) → approved = user's subset
3. "Hủy" → trigger Cancel Handling (see below)
```

**Branch routing:**
- Option 1 OR Option 2 → tiến hành hydration (see §Hydrating Step 2 below) → Step 2
- Option 3 → trigger Cancel Handling

Do NOT proceed to Step 2 until `approved[]` is non-empty AND status ≠ cancelled.

### Hydrating Step 2 after Phase Checkpoint

The conductor knows the actual screen count only **after** the Phase Checkpoint. Source of truth: `bk/dev/{feature-slug}/design/raw/discovery.json` filtered by the user's approval choice.

Steps to hydrate Step 2:
1. Read `discovery.json` to get the full discovered list (`screens[]`)
2. Apply the user's approval choice → produce the **approved screen list** (`approved[]`, length = `M`)
3. Update Step 2:
   - `subject` → `"Step 2: Design spec extraction (M screens)"` (M = approved length)
   - `activeForm` → `"Extracting 0/M screens..."`
   - `metadata` → `{ screensTotal: M, screensCompleted: 0, approvedSlugs: [...] }`

### Cancel Handling

Triggered when user picks "Hủy" at any Phase Checkpoint with a cancel option.

1. Update remaining tasks to terminal state:
   ```
   TaskUpdate(taskId: <Step2>, status: "deleted")
   TaskUpdate(taskId: <Step3>, status: "deleted")
   TaskUpdate(taskId: <Step4>, status: "deleted")
   TaskUpdate(taskId: <Step5>, status: "deleted")
   ```
   (Step 1 stays `completed` — it actually ran.)

2. Record cancellation in `bk/dev/{feature-slug}/.spec-state.json`:
   ```json
   {
     "current_phase": "design_cancelled",
     "design_cancelled_at": "<ISO timestamp>",
     "design_cancelled_reason": "user_aborted_at_<gate_name>"
   }
   ```

3. Skip to Phase 4 Validate (`references/validate-workflow.md`). Validate phase MUST detect `design_cancelled` and:
   - Mark design outputs as N/A in spec-summary
   - Not block Phase 4 completion

4. Do NOT delete `discovery.json` or any file already written — preserve audit trail.

### Step 2: Design Spec Extraction (parallel per screen)

**Prerequisite:** Step 2 task has been **hydrated** with `screensTotal = M` and `approvedSlugs` from §Hydrating Step 2 above. If not yet hydrated, do that first.

Step 2 task covers the whole batch — do **NOT** create per-screen sub-tasks. Tracking pattern: metadata counter + activeForm + filesystem post-verify.

**Pre-dispatch:**

```
TaskUpdate(taskId: <Step2>, status: "in_progress")
// subject/activeForm/metadata.screensTotal already set during hydration
```

**Batching for scale:**
- `M ≤ 15` → dispatch all in ONE message
- `M > 15` → split into waves of ≤ 15 dispatches per message. Wait for each wave to complete before next wave (sequential waves, parallel within wave). Update `screensCompleted` after each wave.

Reason: dispatching 30+ Task calls in one message risks rate limits and stream timeouts.

**Dispatch ALL approved screens** (one Task call per screen in `metadata.approvedSlugs`):

```
Task(
  subagent_type: "design-spec-writer",
  model: "sonnet",
  description: "Design spec {slug}",
  prompt: "
    Task: Extract design spec from Figma screen
    Flow: bk/dev/{feature-slug}/design/
    Component contracts: bk/dev/{feature-slug}/design/raw/component-contracts.json (read first to identify shared components)
    Screen: {nodeId} | Slug: {slug}
    Name: {name} | Size: {width}x{height}
    Output: bk/dev/{feature-slug}/design/{slug}/
  "
)
// ... repeat for each screen in the SAME message (or per wave if M > 15)
```

**As each agent returns:** increment `screensCompleted` and refresh `activeForm`:

```
TaskUpdate(taskId: <Step2>,
  activeForm: "Extracting {completed}/{M} screens...",
  metadata: { screensCompleted: {completed} })
```

(`M` = `screensTotal` set during hydration; do not change it here.)

**Post-verify (filesystem-based, source of truth):**

1. After all dispatched agents return, glob `bk/dev/{feature-slug}/design/*/design.md`
2. Cross-check against `metadata.approvedSlugs`
3. Compute `extracted = present screens`, `missing = approved - extracted`

**Decision:**

| Condition | Action |
|-----------|--------|
| `missing == 0` | `TaskUpdate(<Step2>, status: "completed")`. Continue to Step 3 + Step 4. |
| `missing > 0` AND retries used < 2 | Re-dispatch each missing screen individually (one Task call per missing screen, in one message). Increment retry counter per screen. Re-run post-verify. |
| `missing > 0` AND retries == 2 | Enter Partial Success Gate (below) |

> **PHASE CHECKPOINT** — Step 2 Partial Success
>
> Trigger: 2 retries exhausted, still missing screens. STOP.

AskUserQuestion (Vietnamese):
- **Tiếp tục với {extracted}/{M} màn** → record `design_partial: { extracted, missing: [slugs] }` in `.spec-state.json`. Update Step 2 metadata. Mark `completed`. Continue to Step 3 + Step 4. Step 4 (UI/UX writer) WILL receive partial design.md set + partial flag.
- **Thử lại lần nữa** → reset retry counter, re-run dispatch for missing only
- **Huỷ** → trigger Cancel Handling

### Step 3: Asset Export

```
Task(
  subagent_type: "design-asset-exporter",
  model: "sonnet",
  description: "Export Figma assets",
  prompt: "Flow: bk/dev/{feature-slug}/design/
    Tech stack: read from bk/docs/foundation/build-targets.md (platform = ios | android | flutter)
    Task: Read ALL assets.json files in the flow directory, deduplicate, resolve invalid node IDs, batch export, write platform-specific metadata (Contents.json for iOS, drawable/mipmap dirs for Android, assets/ for Flutter), write asset-export-report.json.
  "
)
```

**Verify** `bk/dev/{feature-slug}/design/raw/asset-export-report.json`.

| Condition | Action |
|-----------|--------|
| `failed == 0` AND `exported > 0` | Mark Step 3 completed |
| `failed > 0` AND retries < 1 | Re-dispatch design-asset-exporter with `failed[]` only (per Retry Policy) |
| `failed > 0` AND retries == 1 | Continue with warning. Log to `.spec-state.json` (`asset_export_warnings: [...]`). Mark Step 3 completed. |
| `exported == 0` | Likely no extractable assets (popup-only feature). AskUserQuestion: *"Không export được asset nào. Tiếp tục hay huỷ?"* — Tiếp tục → mark completed. Huỷ → Cancel Handling. |

### Step 4: UI/UX Requirements

**Prerequisite:** Step 2 complete (design.md files must exist). If `design_partial` is set in `.spec-state.json`, the writer receives the partial set and the partial flag.

```
Task(
  subagent_type: "bk-docs-writer",
  model: "sonnet",
  description: "Write UI/UX requirements for {feature-name}",
  prompt: "
    Write SRS section: UI/UX Requirements for {feature-name} ({feature-slug})
    Context:
      - Read ALL */design.md files in bk/dev/{feature-slug}/design/ (screen designs)
      - bk/docs/foundation/design-system.md (design tokens)
      - bk/dev/{feature-slug}/srs/01-overview.md (if exists — screen flow diagram)
      - bk/dev/{feature-slug}/.spec-state.json (check `design_partial` — if set, mark missing screens as 'TBD' in inventory)
    Load: references/ui-ux-requirements.md
    Template: templates/05-ui-ux-requirements.md
    Synthesize:
      - Screen inventory table (from design.md files)
      - Navigation map (from overview or design.md Section 6)
      - Key UI patterns (bottom sheets, popups, result screens)
      - Interaction specs (per screen)
      - Design tokens used
      - Accessibility requirements
      - Loading/error/empty states
    Output: bk/dev/{feature-slug}/srs/05-ui-ux-requirements.md
  "
)
```

### Step 5: Design Quality Review

```
Task(
  subagent_type: "bk-code-reviewer",
  model: "sonnet",
  description: "Review design spec quality for {feature-name}",
  prompt: "
    Review design documentation for feature: {feature-name} ({feature-slug}).
    Files to review:
      - ALL */design.md files in bk/dev/{feature-slug}/design/
      - bk/dev/{feature-slug}/srs/05-ui-ux-requirements.md
      - bk/dev/{feature-slug}/design/raw/asset-export-report.json (if exists)
    Note: 04-api-contract is in Phase 3 — do NOT check for it.
    Check:
    1. Every design.md has complete section structure (9 sections)
    2. No placeholder content or TODO markers
    3. Mermaid diagrams have valid syntax — semicolons escaped as #59;
    4. 05-ui-ux screen inventory count matches actual design.md file count (or `design_partial.extracted` if partial)
    5. Navigation map consistent with individual design.md interaction specs
    6. Asset export report: failed > 0 → warning
    7. If 01-overview.md exists: verify screen IDs cross-reference SRS use cases
    8. Screens with 0 assets are valid (popups, modals) — do NOT flag
    9. Design.md files up to 900 lines are acceptable — do NOT flag
    TOOL RESTRICTION: READ-ONLY agent. Do NOT use Edit, Bash, or Task tools.
    Output: bk/dev/shared/reports/design-review-{feature-slug}.md
    Verdict: OKAY or REVISE with specific issues
  "
)
```

> **PHASE CHECKPOINT** — Design Review REVISE (initial)
>
> Trigger: Step 5 reviewer verdict = REVISE on first review. STOP.

**On REVISE verdict (initial):** Show issues to user → AskUserQuestion:
- **Sửa lỗi** → enter Iteration 1
- **Tiếp tục không sửa** → continue to Phase 4 Validate, record `design_review_verdict: "REVISE"` in `bk/dev/{feature-slug}/.spec-state.json`
- **Huỷ** → trigger Cancel Handling

**Fix loop (max 2 iterations, user-gated each iter):**

**Iteration 1:**
1. For each REVISE finding in `bk/dev/shared/reports/design-review-{feature-slug}.md`, identify target file:
   - Finding cites `*/design.md` → re-dispatch design-spec-writer for that screen (read existing + apply specific fix, not full rewrite)
   - Finding cites `srs/05-ui-ux-requirements.md` → re-dispatch bk-docs-writer for that file (read existing + apply specific fix)
2. Re-dispatch bk-code-reviewer for re-review (same prompt as Step 5)
3. Verdict OKAY → continue to Phase 4 Validate, record `design_review_verdict: "OKAY"` in `.spec-state.json`
4. Verdict REVISE → enter Iteration 2 checkpoint:

   > **PHASE CHECKPOINT** — Design Review REVISE (iter 1 → 2)
   >
   > Trigger: Iteration 1 fixes still produce REVISE. STOP.

   AskUserQuestion:
   - **Sửa lỗi (iter 2)** → enter Iteration 2
   - **Tiếp tục không sửa** → continue to Phase 4 Validate, record REVISE in `.spec-state.json`
   - **Huỷ** → trigger Cancel Handling

**Iteration 2:**
1. Same re-dispatch logic as Iteration 1
2. Verdict OKAY → continue to Phase 4 Validate, record OKAY
3. Verdict REVISE → enter Final checkpoint:

   > **PHASE CHECKPOINT** — Fix loop exhausted
   >
   > Trigger: 2 fix iterations completed, still REVISE. Max iterations reached. STOP.

   AskUserQuestion: *"Đã hết lượt sửa. Tiếp tục với lỗi còn lại hay huỷ?"*
   - **Tiếp tục với lỗi còn lại** → continue to Phase 4 Validate, record REVISE in `.spec-state.json`
   - **Huỷ** → trigger Cancel Handling

**On OKAY verdict (any iteration):** Record `design_review_verdict: "OKAY"` in `.spec-state.json`. Continue to Phase 4 Validate.

> **WORKFLOW CLEANUP** — End of Design workflow
>
> Trigger: design reviewer verdict OKAY (initial hoặc sau fix loop), HOẶC user chọn "Tiếp tục không sửa", HOẶC Cancel Handling đã chạy. Trước khi return về conductor để enter Phase 4 Validate, MUST `TaskUpdate(status: "deleted")` cho từng task IDs đã tạo trong `## Task Tracking` của workflow này (Step 1-5, kể cả Step 2 đã hydrated). TaskList phải về rỗng. Per SKILL.md rule #5.
