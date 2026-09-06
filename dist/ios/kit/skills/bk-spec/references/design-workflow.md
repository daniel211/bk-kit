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

## Engine Selection

Design extraction runs on one of two engines that produce **identical output**. Resolve once,
before Step 1, and record the answer in `.spec-state.json` as `design_engine`.

Priority: `--engine` flag → `BK_DESIGN_ENGINE` env → `platform-context.json:designEngine` →
default. **The shipped default is `claude`.**

| Engine | Step 1 | Step 2 | Step 3 |
|--------|--------|--------|--------|
| `claude` | design-validator | design-spec-writer × N | design-asset-exporter |
| `agy` | design-agy-extractor (`--mode discovery`) | design-agy-extractor × N (`--mode screen`) | design-asset-exporter |
| `dual` | design-validator | both engines → `design-spec-diff.mjs` | design-asset-exporter |

Asset export stays on the claude engine in every case — see Step 3.

### Preflight

**Every engine needs a Figma token**, because every engine reads Figma the same way — over
REST, via `.claude/scripts/figma-cli.mjs`. Check it first:

```bash
node .claude/scripts/figma-cli.mjs discover --url "{figma_url}" --out {flow}/raw/discovery.json
```

Exit 2 means no token. Stop and tell the user to set `FIGMA_API_KEY` or write
`~/.config/beer-kit/figma.env`; no engine can proceed without it, so there is nothing to
fall back to.

**Only when the resolved engine is `agy` or `dual`**, additionally check that agy can run:

```bash
node -e "import('.claude/scripts/agy-preflight.mjs').then(m=>console.log(JSON.stringify(m.preflightAgyBinary())))"
```

| Result | Action |
|--------|--------|
| `ok: true` | Proceed on agy. Record `design_engine` in `.spec-state.json`. |
| `ok: false` | **Fall back to `claude` for the whole flow.** Print `reason` and `remedy` verbatim, record `design_engine: "claude"` and `design_engine_fallback: "<reason>"`. Do NOT stop and do NOT ask — the claude engine produces the same output from the same data. |

There is no Figma MCP check any more. Neither engine uses one.

### Runtime fallback (per unit, not per flow)

If preflight passed but a dispatch still fails, the failure is scoped to that unit:

| Extractor exit | Meaning | Action |
|---|---|---|
| 0 | Files written and verified | Continue |
| 2 | agy cannot run here | Re-dispatch **this unit only** to the claude agent |
| 3 | Ran but failed the contract | Retry once on agy, then re-dispatch to the claude agent |

Append every fallback to `.spec-state.json`:

```json
"engine_fallbacks": [{ "unit": "03-detail", "from": "agy", "reason": "exit 3: design.md had 7 of 9 sections" }]
```

Step 5 reads this array and names the affected screens in the review report. A flow that
silently mixed engines is a flow nobody can reason about later.

**Never pass `--dangerously-skip-permissions`**, and never tell the user to. When the runner
prints allow-rules, pass them through **verbatim** — a reworded permission rule does not work.

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

**On engine `agy`**, dispatch this instead — same output files, so the verify below is unchanged:

```
Task(
  subagent_type: "design-agy-extractor",
  model: "sonnet",
  description: "Figma discovery (agy)",
  prompt: "Mode: discovery
    Figma URL: {figma_url}
    Flow: bk/dev/{feature-slug}/design/
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

**On engine `agy`**, the per-screen dispatch is:

```
Task(
  subagent_type: "design-agy-extractor",
  model: "sonnet",
  description: "Design spec {slug} (agy)",
  prompt: "Mode: screen
    Screen: {nodeId} | Slug: {slug}
    Flow: bk/dev/{feature-slug}/design/
    Tech stack: {ios|android|flutter}
  "
)
```

Cap agy waves at **5 concurrent dispatches**, not 15: each one starts its own CLI process
with its own MCP connection, so the limit is the machine, not the API.

A `FALLBACK:` or `RETRY:` return is not a failed screen — apply §Runtime fallback and count
the screen once the claude re-dispatch lands.

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

### Step 2b: Engine cross-check (`--engine dual` only)

Both engines extract every approved screen, to **separate paths** — never the same file, or
the slower dispatch silently overwrites the faster one:

- `{slug}/design.md` — claude, **canonical**
- `{slug}/design.agy.md` — agy, the reviewer

Then, per screen:

```bash
node .claude/skills/bk-design/scripts/design-spec-diff.mjs \
  --a bk/dev/{feature-slug}/design/{slug}/design.md \
  --b bk/dev/{feature-slug}/design/{slug}/design.agy.md \
  --out bk/dev/{feature-slug}/design/raw/engine-diff-{slug}.md
```

Exit 4 means CRITICAL differences — the engines read node ids differently, or one dropped a
section. Collect those screens and present them once via AskUserQuestion:

- **Xem khác biệt** → show the diff reports, then continue
- **Tiếp tục** → record `engine_diff_unresolved: [slugs]` in `.spec-state.json`, continue
- **Huỷ** → Cancel Handling

The canonical `design.md` is never modified by this step. Dual mode buys a second opinion,
not an automatic merge — resolving a real disagreement is a judgement call, not a diff.

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

> **Always the claude engine, on every setting.** Asset export writes binaries — PDF, SVG,
> PNG at three scales — and a blank or truncated file cannot be caught by reading text. It
> stays where the verification story is proven until Phase 2 of the engine plan says
> otherwise.

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
    10. Read `.spec-state.json`: if `engine_fallbacks` is non-empty, name those screens and
        the reason in the report — a flow that mixed engines must say so. If
        `engine_diff_unresolved` is set (dual mode), list those screens as open items.
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
