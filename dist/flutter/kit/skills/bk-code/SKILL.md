---
name: bk-code
description: "Implement mobile features from bk-plan output — dispatch agents, track progress, review, commit."
user-invocable: true
argument-hint: "[plan-dir/plan.md or sub-task-XX-*.md] [--fast|--no-review|--parallel|--sequential]"
---

# Implement: $ARGUMENTS

Execute bk-plan output through agent dispatch, dual tracking, and quality gates.
Auto-chain execution: implement → test → review per batch, no manual intervention needed.

<Use_When>
- User says "implement", "build", "develop", "code this plan"
- A plan from bk-plan exists and is ready to execute
- User invokes `/bk-code plan.md` or `/bk-code sub-task-02-viewmodel.md`
</Use_When>

<Do_Not_Use_When>
- No plan exists — use /bk-plan first
- Bug fix needed — use /bk-debug
- Plan only — use /bk-plan
- Code review only — use /bk-code-review
</Do_Not_Use_When>

## Inline Rules (no cross-reference needed)

### FSM Transitions (bk-code)
(none)→plan→coding→testing→review→commit
- review→coding: on critical findings (max 2 fix loops)
- Terminal: commit (success) | escalated (fix-loop exceeded) | aborted

### Approval Gates
- Trivial: auto-approve, skip review
- Standard: ask before commit
- Complex: ask before plan + dispatch + commit
- Auto-approve condition: critical==0 AND warning<3 AND test_pass_rate>90%

### Reactive Signals (check after every agent return)
| Signal | Action |
|--------|--------|
| agent_stuck | → bk-brainstormer → bk-problem-solving → AskUser |
| unknown_api | → bk-docs-seeker → WebSearch → AskUser |
| confidence_low | → bk-sequential-thinking → AskUser |
| fix_loop_stuck | → bk-problem-solving → bk-brainstormer → AskUser |

Max 2 reactive dispatches per signal.

### Adaptive Finalize
| Tier | Agents |
|------|--------|
| Trivial | bk-git-manager |
| Standard | bk-project-manager + bk-git-manager |
| Complex | bk-project-manager + bk-docs-writer + bk-git-manager |

## Workflow Modes

Default: full pipeline. Override with flags.

| Flag | Mode | Test | Review | Use Case |
|------|------|------|--------|----------|
| (none) | full | Yes | Yes | Standard feature implementation |
| `--fast` | fast | Skip | Skip | Quick fix, hotfix, trivial change |
| `--no-review` | no-review | Yes | Skip | Trusted code, time pressure |
| `--parallel` | parallel | Yes | Yes | Force parallel sub-task execution within batch |
| `--sequential` | sequential | Yes | Yes | Force sequential (overrides sub-task parallel-with) |

Load: `references/intent-detection.md`

## Workflow

```
[1. Parse & Resume] → [2. Hydrate Sub-Tasks] → [3. Execute Batches (implement → test → review per batch)] → [4. Finalize]
```

Test + Review happen WITHIN each batch (Step 3), not as separate steps.
Code-Step-4 (Finalize) always runs. Test/Review skipped per mode within each batch.

### Code-Step-1: Parse & Resume
Load: `references/intent-detection.md` + `references/plan-consumption.md`

- Parse $ARGUMENTS for plan.md or sub-task file path
- Read `.plan-state.json` if exists → resume from last incomplete batch/sub-task
- **Foundation check**: Read `bk/docs/foundation/architecture.md` → extract architecture pattern, state management
  - IF missing → warn: "Foundation docs missing. Code quality may be reduced. Consider running `/bk-bootstrap`."
  - IF exists → include architecture pattern + state management + naming conventions in agent dispatch prompt
- Detect platform from plan.md YAML `platforms` field
- Load `.platform-context.json` for platform conventions
- Read `## Execution Batches` table from plan.md → build batch queue

### Code-Step-2: Hydrate Sub-Tasks
Load: `references/plan-consumption.md`

- Read all `sub-task-{NN}-*.md` files, build dependency graph from YAML `depends`
- Each unchecked `[ ]` in sub-task `## Tasks` → TaskCreate with `addBlockedBy` chain
- Skip if < 3 sub-tasks (3-task rule)
- Skip if tasks already exist (TaskList check)
- Group sub-tasks by batch (from plan.md `## Execution Batches` table)

### Code-Step-3: Execute Batches
Load: `references/batch-execution.md` + `references/phase-execution.md`

For each batch in plan.md `## Execution Batches` table (top → bottom):

**3a. Implement** — Dispatch `bk-{platform}-developer` per sub-task in batch
  - Agent reads sub-task file: Scope, Expected Code, Edge Cases, Input References
  - Sub-tasks with `parallel-with:` dispatch concurrently (`run_in_background: true`)
  - Sub-tasks with `depends:` dispatch after dependency completes
  - After each sub-task: checkpoint status + TaskUpdate

**3b. Test** — Dispatch `bk-unit-test-agent` with Test Plan from batch's sub-tasks
  - Agent reads `## Test Plan` sections from all sub-tasks in batch
  - Writes + runs tests, reports pass/fail per test case
  - If tests fail: dispatch `bk-debugger` → fix → re-test (max 2 cycles)

**3c. Review** — Dispatch `bk-code-reviewer` with Review Checklist from batch's sub-tasks
  - Agent reads `## Review Checklist` from all sub-tasks in batch
  - Architecture + Security + Requirements coverage checks
  - If critical findings: fix → re-test → re-review (max 2 cycles) (see Inline Rules above)

**3d. Batch Complete** — All sub-tasks: implement ✓ + test ✓ + review ✓
  - Mark sub-task checkboxes `[x]`, TaskUpdate(completed), update `.plan-state.json`
  - Proceed to next batch

See `references/batch-execution.md` for complete dispatch syntax (copy-paste ready).

### Code-Step-4: Finalize
Load: `references/finalize.md`

1. Full sync-back: sweep ALL sub-task files, mark completed `[x]`, update plan.md statuses
2. Dispatch `bk-docs-writer` (background) → update `bk/docs/` if needed
3. Dispatch `bk-git-manager` → stage + commit with conventional format
4. Write final `.plan-state.json` with status: complete

Finalize agent selection by complexity tier (see Inline Rules above).

## Agent Dispatch Table (Auto-Chain)

| Step | Agent | Model | Trigger | Input |
|------|-------|-------|---------|-------|
| Implement (3a) | `bk-{platform}-developer` | opus | Per sub-task in batch | Sub-task file: Scope, Expected Code, Edge Cases |
| Test (3b) | `bk-unit-test-agent` | haiku | After batch implement | Test Plan sections from batch sub-tasks |
| Debug (3b) | `bk-debugger` | sonnet | If tests fail | Test report + sub-task files |
| Review (3c) | `bk-code-reviewer` | sonnet | After batch tests pass | Review Checklist from batch sub-tasks |
| Security (3c) | `bk-security-auditor` | sonnet | If batch touches auth/security | Changed files + sub-task scope |
| Fix (3c) | `bk-{platform}-developer` | opus | If review has critical findings | Review report + sub-task files |
| Docs (4) | `bk-docs-writer` | sonnet | All batches done | Feature description, changed files |
| Git (4) | `bk-git-manager` | haiku | All batches done | Feature name, files changed |

## Dual Tracking Contract

| Layer | Tool | Purpose | Persists? |
|-------|------|---------|-----------| 
| Session | ClaudeTask (TaskCreate/Update/List) | Orchestration, dependency tracking | No (session-scoped) |
| File | `.plan-state.json` + sub-task checkboxes | Status line, reports, crash recovery | Yes (disk) |

**Sync rule:** Every task completion → BOTH layers updated simultaneously.
- TaskUpdate(completed) + checkbox `[ ]→[x]` + `.plan-state.json` stepResults

## Tool Integration
- **Codebase context:** Use `/bk-repomix` when dispatched agents need full codebase understanding.
- **Library docs:** Use `/bk-docs-seeker` when implementation requires external library APIs.
- **Parallel dev isolation:** Use `/bk-worktree` when `--parallel` mode has >2 devs to avoid file conflicts.
- **When stuck:** Activate `/bk-problem-solving` or `/bk-sequential-thinking` for complex implementation decisions.

## Constraints

- Fix loop max: 2 iterations (then escalate to user)
- Build failure max: 3 retries (then escalate)
- File ownership: respect `owns` YAML — only edit files within scope
- Localization: never hardcode UI text — use Strings table keys
- Single sub-task file argument: execute only that sub-task (skip batch flow)
- Agent names: use canonical bk-* names (e.g. bk-ios-developer, bk-unit-test-agent)

## Reactive Orchestration Reminder

This skill operates within the reactive orchestration framework.
After each agent dispatch and return, check output for reactive signals (see Inline Rules above).

**Helper skills available for dispatch at any point in this workflow:**
- **bk-brainstormer** — agent stuck on approach, architecture concern
- **bk-docs-seeker** — unknown API/framework error
- **bk-sequential-thinking** — complex decomposition, conflicting data
- **bk-problem-solving** — creative breakthrough needed, fix loops
