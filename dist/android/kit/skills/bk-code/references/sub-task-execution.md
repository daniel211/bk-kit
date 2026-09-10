# Sub-Task Execution (Step 3)

Execute sub-tasks within each batch by dispatching bk-{platform}-developer agent (platform detected at runtime).
Each sub-task is a focused unit of work owning a small set of files (3-5 max).

### Step 0: Task Hydration (Session Resume Support)

Before starting any sub-task execution, check if this is a resumed session:

1. **Read sub-task files** — scan `bk/dev/{feature}/` for `plan.md` and `sub-task-*.md`
2. **Check TaskList()** — if empty but sub-task files exist, this is a session resume
3. **Hydrate Tasks:**
   - For each unchecked `- [ ]` item in the sub-task files' `## Tasks` section → `TaskCreate` with description
     (hydrate from `## Tasks` only — `## Edge Cases & Risks`, `## Success Criteria` and
     `## Review Checklist` checkboxes are not tasks)
   - Sub-task with no `## Tasks` section → pre-0.6.0 plan: one `TaskCreate` for the whole
     sub-task, no checkbox hydration (`references/plan-consumption.md` §Legacy plans)
   - Set `addBlockedBy` chains based on sub-task YAML `depends` field
   - Mark already-checked `- [x]` items as completed
4. **Resume execution** from first uncompleted sub-task in current batch

**Sync-back Protocol (at session end):**
- For each completed Task → update sub-task file: `- [ ]` → `- [x]`
- Write completion timestamp to `.plan-state.json`
- Commit sub-task file updates

> This hydration pattern ensures workflow continuity across session compactions and
> creates institutional memory that compounds over time (per Anthropic best practices).

## Sub-Task Selection (within current batch)

1. Read current batch from plan.md `## Execution Batches` table
2. Pick lowest-number unblocked sub-task in batch (all `depends` sub-tasks completed)
3. If sub-task has `parallel-with:` — dispatch concurrently with listed sub-tasks
4. If single sub-task file argument: execute only that sub-task (skip batch flow)
5. TaskUpdate → `in_progress` for all tasks in this sub-task

## Read Sub-Task File

Extract these sections for agent prompt:

| Section | Required | What to Extract |
|---------|----------|-----------------|
| YAML `depends` | Yes | Verify all deps complete |
| YAML `platform` | Yes | Which platform to generate for |
| YAML `owns` | Yes | File ownership scope (3-5 files max) |
| YAML `reqs` | Yes | Requirement IDs for traceability |
| `## Scope` | Yes | Files to create/modify, LOC estimate |
| `## Input References` | Yes | PRD section, API endpoints, dependency outputs |
| `## Expected Code` | Yes | Implementation spec (structure, signatures) |
| `## Edge Cases & Risks` | Yes | Edge cases agent must handle |
| `## Success Criteria` | Yes | Verifiable completion criteria |
| `## Test Plan` | Yes | Test cases for immediate verification after implement |
| `## Review Checklist` | Yes | Sub-task-specific review checks |
| `## Design Specs` | UI sub-tasks | Figma layout, tokens, interactions |
| `## Strings` | UI sub-tasks | Localization table (key, EN, VI) |
| `inputs/generation-input.json` | If exists | Data-driven codegen context |

## Foundation Context in Agent Dispatch

When dispatching dev agents, ALWAYS include foundation context in the prompt:

```
Foundation Context (from bk/docs/foundation/):
- Architecture: {from architecture.md — e.g. MVVM + Clean Architecture}
- State Management: {from architecture.md — e.g. @Observable, Combine, StateFlow}
- Naming: {from code-guidelines.md — e.g. PascalCase classes, camelCase functions}
- Test Pattern: {from code-guidelines.md — e.g. MockRepository protocol, XCTest}
- Key Dependencies: {from dependencies.md — e.g. Alamofire 5.x, Kingfisher 7.x}

Follow these conventions strictly. Do not introduce new patterns.
```

If `bk/docs/foundation/architecture.md` was not found during Code-Step-1, omit this block but add a warning:
`⚠️ No foundation context available. Follow existing code patterns in the sub-task file.`

## Dispatch bk-{platform}-developer (per sub-task)

**Timeout: 15 minutes per dev agent.** Include in dispatch prompt: `Expected completion: 15 minutes. If stuck: save partial progress to output file, report what's blocking.`

```
Task(subagent_type: "bk-ios-developer", model: "opus", description: "Implement sub-task {NN}: {title}", prompt: "
  # Example uses bk-ios-developer; substitute bk-android-developer or bk-flutter-developer at runtime
  Implement sub-task {NN}: {title}
  Sub-task file: {absolute-path-to-sub-task-file}
  Platform context: platform-context.json
  Inputs: {plan-dir}/inputs/generation-input.json
  File ownership: {owns patterns from YAML}
  Requirements: {reqs list from sub-task YAML}

  Read these sections from the sub-task file:
  - ## Scope: files to create/modify
  - ## Expected Code: implementation structure and signatures
  - ## Edge Cases & Risks: edge cases to handle
  - ## Input References: PRD section, API endpoints, dependency outputs

  Rules:
  - Follow Expected Code structure (improve details, don't restructure)
  - Follow Existing Code patterns from foundation docs
  - UI text: use localized string keys from Strings table only
  - Only create/modify files listed in ## Scope (owns enforcement)
  - Run lint + build after each file
  - Update the `## Tasks` checkboxes [ ] → [x] as you complete each
    (never tick `## Edge Cases & Risks` or `## Review Checklist` — those are not progress)
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

### Immediate Test Verification (per sub-task)

After each sub-task implementation completes, check the sub-task's `## Test Plan` section:
- If Test Plan has P0 test cases → run a quick verification:
  - Build the project
  - If existing test infrastructure supports it, run the specific P0 tests listed
  - Log pass/fail for immediate feedback
- This is a quick check, NOT the full batch test phase
- Purpose: catch obvious implementation errors before moving to next sub-task
- If quick check fails: agent can self-correct before returning result

Full test suite execution happens in the batch Test phase (see `references/batch-execution.md`).

### Metrics Capture

Record generation metrics around the dispatch:

1. **Before dispatch**: record `startTime = Date.now()`
2. **After dispatch completes**: record `endTime = Date.now()`, compute `durationMs`
3. **Count generated files**: list files created/modified by agent, count non-empty lines for LOC
4. **Compile results**: after build check, capture `success`, `retries`, `buildTimeMs`
5. **Prompt token estimate**: count chars in prompt sent to bk-{platform}-developer, divide by 4
6. **Agent trace entry**: `{ agent: "bk-{platform}-developer", task: "implement sub-task {NN}", durationMs, attempt }`

## Dispatch bk-generate (Screen Generation Sub-Tasks)

When sub-task YAML contains `type: ui-generation` or `type: screen`:
1. Use bk-generate skill instead of direct bk-{platform}-developer dispatch
2. bk-generate handles: prompt assembly → agent dispatch → compile check → retry
3. Non-generation sub-tasks (data layer, navigation) still use bk-{platform}-developer directly

Detection: if sub-task title contains "screen", "UI", "view", or sub-task YAML has `type: screen` / `type: ui-generation` → use bk-generate.

## Ownership Enforcement

When sub-task YAML includes `owns`:
- Agent MUST only create/modify files matching `owns` glob patterns
- Sub-task scope is small (3-5 files) — ownership is tight
- If a needed file is outside scope: note in output, don't edit
- Shared files not in any `owns`: warn before touching

When `owns` absent: no enforcement (but sub-tasks should always have owns).

## Review Agent Timeout

When dispatching review agents (bk-code-reviewer, bk-security-auditor, bk-performance-analyzer):
**Timeout: 5 minutes per review agent.** Include in dispatch prompt: `Expected completion: 5 minutes. If stuck: save partial progress to output file, report what's blocking.`

## Build Verification

After agent completes:
1. Run `commands.build` from platform context
2. If build fails: resume agent with error output (max 3 retries)
3. After 3 failures: escalate to user

## Post Sub-Task Sync

After each sub-task completes:

1. **ClaudeTask**: TaskUpdate(completed) for each done task in sub-task
2. **Checkboxes**: `- [ ]` → `- [x]` in the sub-task file's `## Tasks` section for completed items.
   Legacy plan (no `## Tasks`): skip this step entirely — leave every checkbox untouched.
3. **Sub-task status**: when ALL `## Tasks` checkboxes checked → update sub-task YAML `status: complete`.
   Legacy plan: set `status: complete` when the sub-task's single task completes.
4. **Plan table**: update plan.md Sub-Tasks table — set Status for this sub-task
5. **.plan-state.json**: add sub-task to `completedSteps`, write `stepResults[NN]`

```json
"stepResults": {
  "NN": {
    "subTask": "NN",
    "title": "...",
    "batch": 1,
    "status": "complete",
    "filesChanged": [...],
    "tasksCompleted": N,
    "generation": {
      "screens": [{ "name": "...", "durationMs": 0, "filesGenerated": [...], "totalLOC": 0, "compile": { "success": true, "retries": 0, "buildTimeMs": 0 }, "promptTokenEstimate": 0 }],
      "agentTrace": [{ "agent": "bk-{platform}-developer", "task": "implement sub-task NN", "durationMs": 0, "attempt": 1 }],
      "totalDurationMs": 0
    }
  }
}
```

If sub-task has no code generation (setup, config), omit `generation` field.

All 5 sync actions MUST happen together. Missing any = inconsistent state.

## Parallel Dispatch Within Batch

When sub-tasks in the same batch have `parallel-with:` referencing each other:

- Dispatch ALL parallel sub-tasks in ONE message with `run_in_background: true`
- Each subagent receives: sub-task file path, platform context, `owns` globs, inputs path
- Wait-all: all parallel agents must complete before proceeding
- Post-completion: run all 5 post-sub-task sync actions for each completed sub-task
- If any agent fails: retry failed sub-task sequentially (max 2 retries), then continue

Sub-tasks with `depends:` on a sub-task in the same batch: dispatch AFTER dependency completes.

See `references/batch-execution.md` for full batch flow (implement → test → review cycle).

## Mode-Aware Execution

When `--fast` mode:
- Execute sub-tasks normally but warn: "Fast mode — test + review skipped within batch."
- Still run build verification after each sub-task.

When `--no-review` mode:
- Execute sub-tasks normally, test runs in batch Test phase, review skipped.

## Single Sub-Task Mode

When argument is `sub-task-XX-*.md` (not plan.md):
1. Read only that sub-task file
2. Skip batch flow and dependency check (user explicitly chose this sub-task)
3. Execute sub-task → sync → done (no batch loop)
4. Quality loop follows mode: full → test+review, fast → skip, no-review → test only
5. Warn: "Single sub-task mode — quality checks per mode flag."
