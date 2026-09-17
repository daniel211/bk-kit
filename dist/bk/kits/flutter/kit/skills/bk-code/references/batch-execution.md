# Batch Execution Protocol (Step 3)

Execute sub-tasks in batches: implement → test → debug (if needed) → review per batch.
Each batch is a complete quality cycle before moving to the next.

## Pre-Flight: Git + Parallel Safety

Before dispatching ANY dev agents, verify:

1. **Git repo exists**: `git rev-parse --is-inside-work-tree` → if false, `git init && git add -A && git commit -m "initial"`
2. **No embedded git repos**: Check for nested `.git` dirs → if found, `rm -rf {nested}/.git && git add {nested}`
3. **Clean working state**: `git status --short` → commit or stash uncommitted changes

**Parallel safety** is enforced by file ownership (`owns:` patterns in sub-task YAML), NOT by git worktree isolation.
Dev agents do NOT use `isolation: worktree` by default — they work directly in the main working directory.
Worktree is optional: only use `/bk-worktree` when --parallel mode has >3 concurrent dev agents AND git state is verified.

## Reading Batches from Plan

Read plan.md `## Execution Batches` table to determine batch order:

```
| Batch | Sub-Tasks | After Implement | After Review |
|-------|-----------|-----------------|--------------|
| 1: Data | 00, 01 | Run sub-task-00,01 tests | Batch review: API + data |
| 2: Logic+UI | 02, 03, 05 | Run sub-task-05 tests | Batch review: logic + UI + Figma |
| 3: Integration | 04, 06 | Run sub-task-06 tests | Final review |
```

Parse each row:
1. **Batch name** — used in report filenames and logs
2. **Sub-task numbers** — read corresponding `sub-task-{NN}-*.md` files
3. **After Implement** — which test sub-tasks to run
4. **After Review** — review focus areas for this batch

Build batch execution queue. Process batches in table order (top → bottom).

## FSM State Per Batch

Each dispatch phase below changes `current_phase` in `bk/dev/shared/.workflow-state.json`
before the dispatch: Implement → `coding`, Test → `testing`, Review → `review`, review fix
loop → `coding` (with `quality_fix_count += 1`). See `references/workflow-state.md` for the
field list, the batch-boundary recurrence reset, and why `.plan-state.json` alone is not enough.

## Per-Batch Execution

For each batch in the Execution Batches table:

---

### Phase 1: Implement

Dispatch `bk-{platform}-developer` for each sub-task in the batch, respecting dependencies.

**Sequential sub-tasks** (sub-task has `depends:` on another sub-task in same batch):
```
Task(subagent_type: "bk-{platform}-developer", model: "opus",
  description: "Implement sub-task {NN}: {title}",
  prompt: "
  Sub-task file: {plan-dir}/sub-task-{NN}-{slug}.md
  Read sections: Scope, Expected Code, Edge Cases, Input References
  Foundation context: bk/docs/foundation/architecture.md, code-guidelines.md
  Platform context: platform-context.json
  Inputs: {plan-dir}/inputs/

  Rules:
  - Follow Expected Code structure (improve details, don't restructure)
  - Follow Existing Code patterns from foundation docs
  - UI text: use localized string keys from Strings table only
  - Only edit files listed in sub-task Scope (owns enforcement)
  - Run lint + build after each file
  - Update the sub-task's `## Tasks` checkboxes [ ] → [x] as you complete each
    (that section only — never tick `## Edge Cases & Risks` or `## Review Checklist`)
  - Report any deviations from Expected Code
  - Verify implementation covers all reqs listed in sub-task YAML
  - Before returning: verify all created/modified files exist and are non-empty

  Expected completion: 15 minutes.
  If stuck: save partial progress to output file, report what's blocking.
  Output: {plan-dir}/research/impl-sub-task-{NN}.md
    Impl report — markdown with YAML frontmatter. Required frontmatter: schema_type: impl-report,
    agent, feature, sub_task, status, timestamp, build_verified, requirements_satisfied,
    files_changed (min 1: {path, change, description}), skills_loaded.
    Required sections: ## Summary, ## Deviations from Expected Code, ## Edge Cases Addressed,
    ## Anti-Patterns Avoided, ## Notes for Reviewer. Schema: bk-agent-contract §3.
    Write it even when blocked — status: needs_info + info_needed. There is no impl-result.json.
")
```

**Parallel sub-tasks** (sub-task has `parallel-with:` listing another sub-task in same batch):
```
# Dispatch all parallel sub-tasks in ONE message with run_in_background: true
Task(subagent_type: "bk-{platform}-developer", model: "opus",
  run_in_background: true,
  description: "Implement sub-task {NN}: {title}",
  prompt: "
  Sub-task file: {plan-dir}/sub-task-{NN}-{slug}.md
  Read sections: Scope, Expected Code, Edge Cases, Input References
  Foundation context: bk/docs/foundation/architecture.md, code-guidelines.md
  Platform context: platform-context.json
  Inputs: {plan-dir}/inputs/

  Rules:
  - Follow Expected Code structure (improve details, don't restructure)
  - Follow Existing Code patterns from foundation docs
  - UI text: use localized string keys from Strings table only
  - Only edit files listed in sub-task Scope (owns enforcement)
  - Run lint + build after each file
  - Update the sub-task's `## Tasks` checkboxes [ ] → [x] as you complete each
    (that section only — never tick `## Edge Cases & Risks` or `## Review Checklist`)
  - Before returning: verify all created/modified files exist and are non-empty

  Expected completion: 15 minutes.
  Output: {plan-dir}/research/impl-sub-task-{NN}.md
    Impl report — markdown with YAML frontmatter. Required frontmatter: schema_type: impl-report,
    agent, feature, sub_task, status, timestamp, build_verified, requirements_satisfied,
    files_changed (min 1: {path, change, description}), skills_loaded.
    Required sections: ## Summary, ## Deviations from Expected Code, ## Edge Cases Addressed,
    ## Anti-Patterns Avoided, ## Notes for Reviewer. Schema: bk-agent-contract §3.
    Write it even when blocked — status: needs_info + info_needed. There is no impl-result.json.
")

Task(subagent_type: "bk-{platform}-developer", model: "opus",
  run_in_background: true,
  description: "Implement sub-task {MM}: {title}",
  prompt: "
  Task: Implement sub-task {MM} — {title}
  Sub-task file: {plan-dir}/sub-task-{MM}-{slug}.md
  ...same structure...
  Output: {plan-dir}/research/impl-sub-task-{MM}.md
    Impl report — markdown with YAML frontmatter. Required frontmatter: schema_type: impl-report,
    agent, feature, sub_task, status, timestamp, build_verified, requirements_satisfied,
    files_changed (min 1: {path, change, description}), skills_loaded.
    Required sections: ## Summary, ## Deviations from Expected Code, ## Edge Cases Addressed,
    ## Anti-Patterns Avoided, ## Notes for Reviewer. Schema: bk-agent-contract §3.
    Write it even when blocked — status: needs_info + info_needed. There is no impl-result.json.
")
```

After each sub-task completes:
- Checkpoint: mark sub-task `status: complete` in YAML frontmatter
- TaskUpdate(completed) for that sub-task
- Update `.plan-state.json` with sub-task result

Wait for ALL sub-tasks in batch to complete before proceeding to Test phase.

---

### Gate: Impl Reports Before Test

Before dispatching the test agent, confirm every sub-task in the batch wrote its impl report.
This is the `coding → testing` artifact required by `rules/state-machine.md`. Union the
reports' `files_changed` and pass that list to the test agent — do not let it re-derive scope.

A report with `status: needs_info` is not a pass: read `info_needed`, resolve it, re-dispatch.

### Phase 2: Test

After all sub-tasks in batch are implemented, dispatch test agent:

```
Task(subagent_type: "bk-unit-test-agent", model: "haiku",
  run_in_background: true,
  description: "Test batch {N}: {batch-name}",
  prompt: "
  Batch: {batch-name}
  Sub-task files with Test Plans:
  - {plan-dir}/sub-task-{NN}-{slug}.md → ## Test Plan section
  - {plan-dir}/sub-task-{MM}-{slug}.md → ## Test Plan section

  Test cases (aggregated from sub-task Test Plan tables):
  {paste all test case rows from sub-tasks in this batch}

  Implemented code files:
  {union of files_changed from each sub-task's impl report in this batch}
  Impl reports: {plan-dir}/research/impl-sub-task-{NN}.md, ...

  Platform context: platform-context.json
  Foundation test pattern: bk/docs/foundation/code-guidelines.md → Test Pattern section

  Instructions:
  - Write real test code for each test case row
  - P0 = must pass, P1 = should pass, Edge = best effort
  - Do NOT mock excessively — use real fakes/in-memory implementations
  - Run all tests, report pass/fail per test case
  - If test fails: identify which sub-task's code is the root cause
  - Before returning: verify all test files exist and results are reported

  Expected completion: 10 minutes.
  Output: {plan-dir}/research/test-batch-{N}.md
")
```

---

### Phase 3: Debug (conditional — only if tests fail)

If test report shows failures, dispatch debugger:

```
Task(subagent_type: "bk-debugger", model: "sonnet",
  description: "Debug batch {N} test failures",
  prompt: "
  Test report: {plan-dir}/research/test-batch-{N}.md
  Failed tests: {list failed test names and errors}
  Sub-task files: {paths to sub-tasks whose code failed}
  Implemented files: {list of source files from failed sub-tasks}

  Diagnose root cause for each failure.
  Recommend specific fix (file, line, change).
  Output: {plan-dir}/research/debug-batch-{N}.md
")
```

Then re-implement fix:
```
Task(subagent_type: "bk-{platform}-developer", model: "opus",
  description: "Fix sub-task {NN} per debug findings",
  prompt: "
  Debug report: {plan-dir}/research/debug-batch-{N}.md
  Sub-task file: {plan-dir}/sub-task-{NN}-{slug}.md
  Apply recommended fixes. Run build check.
  Output: {plan-dir}/research/fix-sub-task-{NN}.md
")
```

Then re-test:
```
Task(subagent_type: "bk-unit-test-agent", model: "haiku",
  run_in_background: true,
  description: "Re-test batch {N} after fix",
  prompt: "
  Re-run failed tests from: {plan-dir}/research/test-batch-{N}.md
  Fix applied: {plan-dir}/research/fix-sub-task-{NN}.md
  Output: {plan-dir}/research/test-batch-{N}-retry-{cycle}.md
")
```

**Max 2 debug cycles per batch.** After 2 cycles with remaining failures:
- Escalate to user via `AskUserQuestion`:
```json
{
  "questions": [{
    "question": "Batch {N} tests still failing after 2 fix cycles. How to proceed?",
    "header": "Test Failure Escalation",
    "options": [
      { "label": "Fix manually", "description": "I'll fix the failing tests myself" },
      { "label": "Skip failing tests", "description": "Proceed to review, document failures" },
      { "label": "Abort", "description": "Stop batch execution" }
    ]
  }]
}
```

---

### Phase 4: Review

After tests pass (or user chose to skip), dispatch reviewer:

```
Task(subagent_type: "bk-code-reviewer", model: "sonnet",
  run_in_background: true,
  description: "Review batch {N}: {batch-name}",
  prompt: "
  Batch: {batch-name}
  Review focus: {batch review focus from plan.md Execution Batches table}

  Review checklists (aggregated from sub-task files):
  {paste all ## Review Checklist items from sub-tasks in this batch}

  Changed files:
  {union of files_changed from each sub-task's impl report in this batch}

  Impl reports: {plan-dir}/research/impl-sub-task-{NN}.md, ...
    Frontmatter is the dev agent's claim, not evidence. Cross-validate every claim against
    the actual source: files_changed accurate? requirements_satisfied really implemented?
    build_verified backed by a build that ran? Read ## Deviations from Expected Code and
    ## Notes for Reviewer before starting.

  Sub-task files: {list paths for reference}
  Platform context: platform-context.json
  Foundation: bk/docs/foundation/architecture.md, code-guidelines.md

  Check:
  - Architecture compliance with foundation patterns
  - Code quality (KISS/DRY, naming, file size < 200 LOC)
  - Error handling completeness
  - No hardcoded values or UI text
  - Sub-task-specific checklist items above
  - Requirements coverage (reqs from sub-task YAML)

  Before returning: verify report file exists and is non-empty.
  Output: score (1-10), critical issues, warnings, info.
  Save report to: {plan-dir}/research/review-batch-{N}.md

  Expected completion: 5 minutes.
")
```

**Optional security reviewer** — dispatch when batch sub-tasks touch auth, payment, or sensitive data:
```
Task(subagent_type: "bk-security-auditor", model: "sonnet",
  run_in_background: true,
  description: "Security review batch {N}",
  prompt: "
  Task: Security review batch {N}
  Changed files: {list}
  Focus: hardcoded secrets, token storage, input validation, OWASP top 10,
  auth patterns, data exposure, insecure network calls.
  Output: {plan-dir}/research/review-security-batch-{N}.md
")
```

**If critical findings from review:**

1. Dispatch `bk-{platform}-developer` to fix critical issues:
```
Task(subagent_type: "bk-{platform}-developer", model: "opus",
  description: "Fix review findings for batch {N}",
  prompt: "
  Review report: {plan-dir}/research/review-batch-{N}.md
  Critical issues to fix: {list critical issues}
  Sub-task files: {paths}
  Apply fixes. Run build check.
  Output: {plan-dir}/research/review-fix-batch-{N}.md
")
```

2. Re-test after fix:
```
Task(subagent_type: "bk-unit-test-agent", model: "haiku",
  run_in_background: true,
  description: "Re-test batch {N} after review fix",
  prompt: "
  Re-run all batch {N} tests to verify review fixes didn't break anything.
  Output: {plan-dir}/research/test-batch-{N}-post-review.md
")
```

3. Re-review (only focus areas with critical findings):
```
Task(subagent_type: "bk-code-reviewer", model: "sonnet",
  run_in_background: true,
  description: "Re-review batch {N} fixes",
  prompt: "
  Previous review: {plan-dir}/research/review-batch-{N}.md
  Fixes applied: {plan-dir}/research/review-fix-batch-{N}.md
  Verify critical issues are resolved.
  Output: {plan-dir}/research/review-batch-{N}-retry.md
")
```

**Max 2 review fix cycles per batch.** Then escalate to user.

---

## Batch Complete

A batch is complete when ALL of these are true:
- ✅ All sub-tasks in batch: implemented and build passes
- ✅ Every sub-task in the batch has an impl report at
  `{plan-dir}/research/impl-sub-task-{NN}.md` with `status: complete` and `files_changed`
  (min 1). A missing report means the dev agent did not finish — re-dispatch or escalate;
  do not mark the sub-task done on the strength of source files alone.
- ✅ All P0 tests pass (P1 should pass, edge cases best effort)
- ✅ No critical review findings (or fixed within 2 cycles)
- ✅ No files edited outside sub-task `owns` scope

### State Updates on Batch Complete

1. **Sub-task checkboxes**: mark all `[ ]` → `[x]` in each sub-task file's `## Tasks` section
2. **Sub-task YAML**: update `status: complete` in each sub-task frontmatter
3. **ClaudeTask**: `TaskUpdate(completed)` for each sub-task in batch
4. **Plan table**: update plan.md Sub-Tasks table — set Status = `done` for batch sub-tasks
5. **.plan-state.json**: add batch sub-tasks to `completedSteps`, write batch results:

```json
"batchResults": {
  "1": {
    "name": "Data",
    "status": "complete",
    "subTasks": ["00", "01"],
    "testReport": "research/test-batch-1.md",
    "reviewReport": "research/review-batch-1.md",
    "fixCycles": 0,
    "filesChanged": ["..."],
    "completedAt": "..."
  }
}
```

6. **.workflow-state.json**: write `batch: N+1` and `phase_recurrence_count: {}` — leave
   `current_phase` unchanged so the write is not a transition. This is what stops a 4-batch
   plan from tripping the phase-recurrence block on batch 3. Reset only on a batch that
   actually completed; never to escape a fix loop.
7. **Log**: `"✓ Batch {N} ({name}) complete — {sub-task count} sub-tasks, {file count} files changed"`

### Proceed to Next Batch

After state updates, move to next row in Execution Batches table.
Next batch's sub-tasks may depend on current batch — dependency already satisfied.

If current batch is the LAST batch → proceed to Step 4: Finalize.

## Metrics Capture

Record per-batch metrics:

1. **Before batch**: `batchStartTime = Date.now()`
2. **Per sub-task**: `{ subTask: "NN", durationMs, filesChanged: [...], totalLOC }`
3. **Test results**: `{ passed: N, failed: N, skipped: N, coveragePercent }`
4. **Review results**: `{ score: N, criticalCount: N, warningCount: N, fixCycles: N }`
5. **After batch**: `batchDurationMs = Date.now() - batchStartTime`
6. **Agent trace**: append to `.plan-state.json` agentTrace array:
```json
{ "agent": "bk-{platform}-developer", "task": "implement sub-task {NN}", "batch": N, "durationMs": 0, "attempt": 1 }
{ "agent": "bk-unit-test-agent", "task": "test batch {N}", "batch": N, "durationMs": 0 }
{ "agent": "bk-code-reviewer", "task": "review batch {N}", "batch": N, "durationMs": 0 }
```

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
