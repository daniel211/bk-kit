# SRS Documentation Workflow

## Overview

Generate feature SRS at `bk/dev/{feature-slug}/srs/`.

## Task Tracking

Create tasks upfront with dependencies, then update status as each step executes:

```
TaskCreate(subject: "Step 1: SRS Overview + Diagrams", activeForm: "Sinh SRS overview...")
TaskCreate(subject: "Step 2: Functional + Non-functional Reqs", activeForm: "Sinh requirements...", blockedBy: [Step 1])
TaskCreate(subject: "Step 3: SRS Quality Review", activeForm: "Review chất lượng SRS...", blockedBy: [Step 2])
```

Before each step: `TaskUpdate(status: "in_progress")`. After: `TaskUpdate(status: "completed")`.

## Workflow Steps

### Step 1: SRS Overview + Diagrams (foreground)

```
Task(
  subagent_type: "bk-docs-writer",
  model: "sonnet",
  description: "Write SRS overview + diagrams for {feature-name}",
  prompt: "
    Write SRS overview for feature: {feature-name} ({feature-slug})
    Platform: {from foundation}
    Source quality: {source_quality}
    Context:
      - Foundation: bk/docs/foundation/overview.md
      - URD content: {urd_path_or_content} (read to extract business goals, stakeholders, scope, constraints)
    Load: references/srs-diagrams.md (diagram guidelines)
    Load: references/srs-synthesis.md (synthesis rules)
    Template: templates/01-srs-overview.md
    Generate ALL diagrams in this file:
      - System Context (C4 L1) — always
      - Core flow sequence diagrams — one per Must-priority flow
      - Screen flow diagram — only if Figma input available (from design.md files)
    If source_quality != 'verified':
      - Add 'source_quality: {value}' to frontmatter
      - Add Source Quality Notice after Project Scope:
        > ⚠ SOURCE QUALITY: {LOW|MEDIUM} — Requirements suy luận từ {source},
        > chưa xác nhận từ tài liệu yêu cầu.
    Output: bk/dev/{feature-slug}/srs/01-overview.md
  "
)
```

Wait for overview to complete. Diagrams from overview are passed as context to Step 2 writers.

### Step 2: SRS Sections (parallel foreground)

Both sections depend only on 01-overview.md — dispatch in ONE message:

```
Task(subagent_type: "bk-docs-writer", model: "sonnet",
  description: "Write functional requirements for {feature-name}",
  prompt: "
    Write SRS section: Functional Requirements
    Source quality: {source_quality}
    Context: bk/dev/{feature-slug}/srs/01-overview.md (read first), bk/docs/foundation/
    URD content: {urd_path_or_content} (if provided)
    If source_quality != 'verified': tag acceptance criteria '(inferred — cần xác nhận)'
    Load: references/functional-requirements.md
    Template: templates/02-functional-requirements.md
    Diagrams: embed relevant sequence diagrams (coreFlowDiagrams) from overview
    Output: bk/dev/{feature-slug}/srs/02-functional-requirements.md
  "
)

Task(subagent_type: "bk-docs-writer", model: "sonnet",
  description: "Write non-functional requirements for {feature-name}",
  prompt: "
    Write SRS section: Non-Functional Requirements
    Context: bk/dev/{feature-slug}/srs/01-overview.md, bk/docs/foundation/
    Load: references/nonfunctional-requirements.md
    Template: templates/03-nonfunctional-requirements.md
    Output: bk/dev/{feature-slug}/srs/03-nonfunctional-requirements.md
  "
)

```

Wait for both to complete before proceeding to Step 3.

### Step 3: SRS Quality Review

```
Task(
  subagent_type: "bk-code-reviewer",
  model: "sonnet",
  description: "Review SRS quality for {feature-name}",
  prompt: "
    Review SRS documents (01-overview, 02-functional, 03-nonfunctional) in bk/dev/{feature-slug}/srs/.
    Check:
    1. All use cases have acceptance criteria
    2. NFRs are measurable (numbers, not adjectives)
    3. Mermaid diagrams render correctly (valid syntax)
    4. No placeholder content or TODO markers
    5. Cross-references between files are valid
    6. If degraded_mode: verify Source Quality Notice exists in overview
    Output: bk/dev/shared/reports/srs-review-{feature-slug}.md
    Verdict: OKAY or REVISE with specific issues
  "
)
```

> **PHASE CHECKPOINT** — SRS quality REVISE (initial)
>
> Trigger: bk-code-reviewer verdict = REVISE on first review. SRS review ALWAYS asks user (per project rule). STOP.

**On REVISE verdict (initial):** Show issues to user → AskUserQuestion:
- **Sửa tất cả** → enter Iteration 1
- **Chỉ sửa critical** → enter Iteration 1 (critical issues only)
- **Tiếp tục không sửa** → continue to next phase, record REVISE in .spec-state.json
- **Huỷ** → abort workflow

**Fix loop (max 2 iterations, user-gated each iter):**

**Iteration 1:**
1. Re-dispatch bk-docs-writer (sonnet, foreground) per file with issues. Prompt: read existing file + apply specific fixes from review (not full rewrite)
2. Re-dispatch bk-code-reviewer (sonnet) for re-review
3. Verdict OKAY → continue to next phase
4. Verdict REVISE → enter Iteration 2 checkpoint:

   > **PHASE CHECKPOINT** — SRS quality REVISE (iter 1 → 2)
   >
   > Trigger: Iteration 1 fixes still produce REVISE verdict. STOP and ask user before trying Iteration 2.

   AskUserQuestion:
   - **Sửa tất cả (iter 2)** → enter Iteration 2
   - **Chỉ sửa critical (iter 2)** → enter Iteration 2 (critical only)
   - **Tiếp tục không sửa** → continue to next phase, record REVISE
   - **Huỷ** → abort workflow

**Iteration 2:**
1. Re-dispatch bk-docs-writer + bk-code-reviewer (same as Iteration 1)
2. Verdict OKAY → continue to next phase
3. Verdict REVISE → enter Final checkpoint:

   > **PHASE CHECKPOINT** — Fix loop exhausted
   >
   > Trigger: 2 fix iterations completed, still REVISE. Max iterations reached. STOP.

   AskUserQuestion: "Đã hết lượt sửa. Tiếp tục với lỗi còn lại hay huỷ?"
   - **Tiếp tục với lỗi còn lại** → continue to next phase, record REVISE in .spec-state.json
   - **Huỷ** → abort workflow

**On OKAY verdict:** Continue to next applicable phase (Phase 2 if Figma provided, Phase 3 if api_path provided, else Phase 4 Validate).

> **WORKFLOW CLEANUP** — End of SRS workflow
>
> Trigger: SRS reviewer verdict OKAY (initial hoặc sau fix loop), HOẶC user chọn "Tiếp tục không sửa" tại bất kỳ checkpoint nào. Trước khi return về conductor để enter workflow tiếp theo, MUST `TaskUpdate(status: "deleted")` cho từng task IDs đã tạo trong `## Task Tracking` của workflow này (Step 1/2/3). TaskList phải về rỗng. Per SKILL.md rule #5.
