# Workflow Modes

## Auto-Detection (Default)

Triage result (from `feature-triage.md`) + complexity signals determine mode:

| Triage Result | Mode | Rationale |
|---------------|------|-----------|
| Small (0-1 signals) | fast | Skip research overhead |
| Normal (2-3 signals) | deep if unfamiliar domain, fast otherwise | Balance speed vs quality |
| Large (4-5 signals) | deep | Full pipeline needed |
| Massive (6 signals) | deep + suggest split | Vertical slicing recommended |

Additional signals:

| Signal | Mode | Rationale |
|--------|------|-----------|
| 1-2 files, config change | fast | Trivial scope |
| UI + API + auth/storage + 3+ screens | deep | High blast radius |
| >= 4 phases expected | deep | Critic review needed |
| >= 3 independent screens/features/services | parallel | Enable concurrent phases |

## Canonical Step Numbers

All modes use the same step numbering from SKILL.md.
Fast mode skips steps but records canonical numbers in `.plan-state.json`.

| Step | Name | Fast | Deep |
|------|------|------|------|
| 1 | Parse & Triage | Run | Run |
| 2 | Input Processing | If provided | If provided |
| 3 | Code Analysis | Run | Run (full + scout) |
| 4 | Research | **Skip** | Run (dispatch) |
| 5 | Gap Escalation | **Skip** (unless CRITICAL) | Run |
| 6 | Synthesize Plan | Run | Run |
| 7 | Critic Review | **Skip** (unless >= 4 phases) | Run (dispatch) |
| 8 | Validate | **Skip** | Run |
| 9 | Hydrate Tasks | If >= 3 phases | If >= 3 phases |
| 10 | Present | Run | Run |

## Fast Mode (`--fast`)

Steps: 1 → [2] → 3 → 6 → [9] → 10.
Skip: 4 (research), 5 (gap escalation), 7 (critic), 8 (validate).

Best for: known patterns, small features, single screen.

**CRITICAL gap escape hatch**: If code analysis (step 3) detects a CRITICAL gap
(e.g., shared interceptor change affecting 20+ files), escalate to user before synthesis
even in fast mode. This is the only exception to skipping step 5.

State tracking uses canonical numbers:
```
Step 1 → .plan-state.json: currentStep: 3 (skipping nothing yet)
Step 3 → .plan-state.json: currentStep: 6 (skipped 4, 5)
Step 6 → .plan-state.json: currentStep: 9 or 10 (skipped 7, 8)
```

## Deep Mode (`--deep`)

Steps: 1 → [2] → 3 → 4 → 5 → 6 → 7 → 8 → [9] → 10.
Full pipeline. Best for: new feature areas, multi-platform, architecture changes.

Details per step:
- **Step 1**: Parse arguments, detect platform, triage scope
- **Step 2**: P3 extraction → `inputs/` (if sources provided; note gaps if missing)
- **Step 3**: Code analysis: full scan with blast radius + scout for large codebases
- **Step 4**: Dispatch max 2 researchers (see `agent-dispatch.md` for exact prompts)
  - Output: `{plan-dir}/research/researcher-*.md`
- **Step 5**: Aggregate gaps from steps 2-4, classify severity, ask user for CRITICAL/HIGH
  - See: `gap-escalation.md`
- **Step 6**: Synthesize plan.md + phase files with expected code, file ownership, traceability
- **Step 7**: Dispatch critic agent (skip if < 4 phases)
  - Output: `{plan-dir}/research/critic-review.md`
  - See: `agent-dispatch.md` for exact prompt
- **Step 8**: Validate interview: 3-6 critical questions
- **Step 9**: Hydrate tasks with dependency chain (skip if < 3 phases)
- **Step 10**: Write final `.plan-state.json`, present to user, output `/bk-code` command

## Parallel Mode (`--parallel`)

Triggered by `--parallel` flag or auto-detection (>= 3 independent screens/features/services).
`--sequential` forces sequential regardless of auto-detection signals.

Steps: same as Deep (1 → [2] → 3 → 4 → 5 → 6 → 7 → 8 → [9] → 10) + parallel-specific synthesis in step 8.

### Detection Signals

| Signal | Result |
|--------|--------|
| >= 3 screens/features/services with no shared service layer | parallel |
| >= 3 service layers with no shared state | parallel |
| Tightly-coupled screens (share services/state) | sequential deps between them, not fully parallel |
| `--parallel` flag provided | parallel (forced) |
| `--sequential` flag provided | sequential (opt-out, overrides auto-detection) |

### Parallel-Specific Synthesis (Step 8)

- Add `execution: parallel` to plan.md frontmatter
- Each phase YAML must include `owns:` with glob patterns; no two phases may share a file glob
- Shared files (e.g., router, theme) assigned to ONE designated phase explicitly
- Write dependency graph in plan.md: which phases form parallel groups, which are sequential dependencies
- See `parallel-planning.md` for detection algorithm, ownership matrix, and dependency graph format

### Mode-Specific Phase Output

| Mode | Expected Code | Strings Table | Test Phase | Code Impact | File Ownership |
|------|--------------|---------------|------------|-------------|----------------|
| fast | Signatures + structure | Yes for UI | Case table only | Brief (modify/new list) | Optional |
| deep | Full preview per platform | Yes for UI | Full table + edge cases | Detailed (snippets + blast radius) | Required |
| parallel | Full preview per platform | Yes for UI | Full table + edge cases | Detailed (snippets + blast radius) | Required + `owns:` per phase |
