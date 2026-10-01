---
name: bk-code
description: "Implement mobile features from bk-plan output — dispatch agents, track progress, review, commit."
user-invocable: true
argument-hint: "[plan-dir/plan.md or sub-task-XX-*.md] [--fast|--no-review|--parallel|--sequential]"
---

# Implement: $ARGUMENTS

Execute bk-plan output through agent dispatch, dual tracking, and quality gates. Auto-chain:
implement → test → review per batch, no manual intervention needed.

<Use_When>
- User says "implement", "build", "develop", "code this plan"
- A plan from bk-plan exists and is ready to execute
- User invokes `/bk-code plan.md` or `/bk-code sub-task-02-viewmodel.md`
</Use_When>

<Do_Not_Use_When>
- No plan exists, or plan only — use /bk-plan
- Bug fix needed — use /bk-debug
- Code review only — use /bk-review
</Do_Not_Use_When>

## Inline Rules (no cross-reference needed)

### FSM Transitions (bk-code)
`(none)→plan→coding→testing→review→commit`; `review→coding` on critical findings (max 2 fix
loops). Terminal: commit (success) | escalated (fix-loop exceeded) | aborted.

**Every transition writes BOTH state files** — `bk/dev/shared/.workflow-state.json`
(`current_phase` + `workflow_type: "bk-code"`) and `{plan-dir}/.plan-state.json`.
Phase changes: `node .claude/cli/bk-health/index.cjs --set-phase <phase>` (validated like an Edit, no Read
needed); batch boundary: `--batch next`. `.plan-state.json` alone leaves `fsm-guard` inert: no transition validation, no phase-recurrence
ladder, nothing for `compact-recovery` to restore. Load: `references/workflow-state.md`

### Approval Gates
Trivial: auto-approve, skip review. Standard: ask before commit. Complex: ask before plan +
dispatch + commit. Auto-approve when `critical==0 AND warning<3 AND test_pass_rate>90%`.

### Reactive Signals (check after every agent return)
`agent_stuck` → bk-brainstormer → bk-problem-solving → AskUser ·
`unknown_api` → bk-docs-seeker → WebSearch → AskUser ·
`confidence_low` → bk-sequential-thinking → AskUser ·
`fix_loop_stuck` → bk-problem-solving → bk-brainstormer → AskUser.
Max 2 reactive dispatches per signal.

### Adaptive Finalize
Trivial → bk-git-manager. Standard → + bk-project-manager. Complex → + bk-docs-writer.

## Workflow Modes

Default: full pipeline (test + review). `--fast` skips both (hotfix / trivial); `--no-review`
keeps tests, skips review; `--parallel` forces parallel sub-task execution within a batch;
`--sequential` forces sequential (overrides sub-task `parallel-with`).
Load: `references/intent-detection.md`

## Workflow

`[1. Parse & Resume] → [2. Hydrate Sub-Tasks] → [3. Execute Batches] → [4. Finalize]`

Test + Review happen WITHIN each batch (Step 3), not as separate steps. Step 4 always runs;
test/review are skipped per mode inside each batch.

### Code-Step-1: Parse & Resume
Load: `references/intent-detection.md` + `references/plan-consumption.md`

- Parse `$ARGUMENTS` for the plan.md or sub-task path; read `.plan-state.json` to resume the last
  incomplete batch (state present but `.workflow-state.json` missing → re-derive the phase from
  `completedSteps`, never start over)
- **Foundation check**: `bk/docs/foundation/architecture.md` → architecture pattern + state
  management + naming conventions go into every dispatch prompt. Missing → warn "Foundation docs
  missing. Code quality may be reduced. Consider running `/bk-bootstrap`." and continue
- Detect platform from plan.md YAML `platforms`, load `platform-context.json`
- Read `## Execution Batches` from plan.md → build the batch queue
- **FSM:** write `.workflow-state.json` → `current_phase: "plan"` + `workflow_type: "bk-code"`,
  `feature`, `plan_dir`, `platform`, `complexity_tier`, `total_batches`

### Code-Step-2: Hydrate Sub-Tasks
Load: `references/plan-consumption.md`

- Read all `sub-task-{NN}-*.md`, build the dependency graph from YAML `depends`
- Each unchecked `[ ]` in `## Tasks` → TaskCreate with an `addBlockedBy` chain.
  **`## Tasks` is the ONLY hydration source** — `## Edge Cases & Risks`, `## Success Criteria` and
  `## Review Checklist` are plain bullets, never hydrated or ticked
- No `## Tasks` section → pre-0.6.0 plan: ONE task for the whole sub-task, warn once per plan dir
  (sunset 0.8.0 — `references/plan-consumption.md` §Legacy plans)
- Skip if < 3 sub-tasks (3-task rule) or tasks already exist (TaskList check)
- Group sub-tasks by batch (plan.md `## Execution Batches`)

### Code-Step-3: Execute Batches
Load: `references/batch-execution.md` (complete copy-paste dispatch syntax)
+ `references/sub-task-execution.md` + `references/workflow-state.md`

For each batch in the `## Execution Batches` table (top → bottom):

| Phase | Action | FSM write before dispatch |
|-------|--------|---------------------------|
| **3a. Implement** | `bk-{platform}-developer` per sub-task (`parallel-with:` → concurrent background, `depends:` → after dependency) | `current_phase: "coding"` + `batch: N` |
| **3b. Test** | `bk-unit-test-agent` over the batch's `## Test Plan` sections; failures → `bk-debugger` → fix → re-test (max 2 cycles). Plan test sub-tasks run by the developer may count, but record it: `--field testing_evidence=<report>` (workflow-state.md) | `current_phase: "testing"` |
| **3c. Review** | `bk-code-reviewer` over the batch's `## Review Checklist` (+ `bk-security-auditor` if the batch touches auth/security); critical findings → fix → re-test → re-review (max 2 cycles) | `current_phase: "review"`; on a fix loop back, `current_phase: "coding"` + `quality_fix_count += 1` |

Models: developer opus, unit-test haiku, debugger/reviewer/auditor sonnet, docs-writer sonnet,
git-manager haiku. Full dispatch table with triggers and inputs:
`references/batch-execution.md` § Agent Dispatch Table.

**3d. Batch Complete** — all sub-tasks implement ✓ + test ✓ + review ✓ → tick `## Tasks` `[x]`,
TaskUpdate(completed), update `.plan-state.json`. **FSM:** `node .claude/cli/bk-health/index.cjs --batch next`
(= `batch: N+1` + `phase_recurrence_count: {}` in one write, `current_phase` unchanged). A multi-batch plan re-enters
`coding` once per batch; without this reset the recurrence ladder blocks batch 3 as if it were a
fix loop. Reset on batch *progress* only, never to escape a fix loop.

### Code-Step-4: Finalize
Load: `references/finalize.md`

Full sync-back (sweep ALL sub-task files, mark `[x]`, update plan.md statuses) → `bk-docs-writer`
(background) updates `bk/docs/` if needed → **FSM** `current_phase: "commit"` → `bk-git-manager`
stages + commits → write final `.plan-state.json` with `status: complete`. Agent set by complexity
tier (see Inline Rules).

## Dual Tracking Contract

| Layer | Tool | Purpose | Persists? |
|-------|------|---------|-----------|
| Session | ClaudeTask (TaskCreate/Update/List) | Orchestration, dependency tracking | No |
| Progress | `{plan-dir}/.plan-state.json` + `## Tasks` checkboxes | Status line, reports, crash recovery | Yes |
| FSM | `bk/dev/shared/.workflow-state.json` | Phase validation, recurrence ladder, compaction recovery | Yes |

**Sync rule:** every task completion updates all three at once — TaskUpdate(completed) + checkbox
`[ ]→[x]` + `.plan-state.json` stepResults; every phase change writes `.workflow-state.json`
`current_phase` (`references/workflow-state.md`).

## Tool Integration
`/bk-repomix` when agents need full codebase context · `/bk-docs-seeker` for external library APIs
· `/bk-worktree` when `--parallel` has >2 devs (file-conflict isolation) · `bk-problem-solving` /
`bk-sequential-thinking` when stuck on an implementation decision.

## Constraints

- Fix loop max 2, build failure max 3 — then escalate (`current_phase: "escalated"`)
- File ownership: respect `owns` YAML — only edit files within scope
- Localization: never hardcode UI text — use Strings table keys
- Single sub-task file argument: execute only that sub-task (skip batch flow)
- Agent names: canonical bk-* names (e.g. bk-ios-developer, bk-unit-test-agent)

## Reactive Orchestration Reminder

After each agent dispatch returns, check its output for reactive signals (see Inline Rules above).
Helper skills dispatchable at any point: **bk-brainstormer** (stuck on approach / architecture
concern), **bk-docs-seeker** (unknown API or framework error), **bk-sequential-thinking** (complex
decomposition, conflicting data), **bk-problem-solving** (fix loops, breakthrough needed).
