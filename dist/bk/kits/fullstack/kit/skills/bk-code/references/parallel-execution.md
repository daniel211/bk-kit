# Parallel Execution (Step 3 — Parallel Mode)

Full algorithm for dispatching bk-{platform}-developer agents in parallel groups (platform detected at runtime).

## Mode Detection

Execution mode is resolved by intent-detection.md. This file is loaded only when
`execution == "parallel"`. If `execution == "sequential"`, use standard sub-task-execution.md loop.

## Auto-Detection Algorithm

When plan frontmatter has `execution: auto`:

```
FUNCTION autoDetect(subTasks):
  IF len(subTasks) < 3: RETURN "sequential"
  noDepSubTasks = subTasks WHERE depends == [] OR depends absent
  IF len(noDepSubTasks) < 2: RETURN "sequential"
  # Check for file overlap between no-dep sub-tasks
  allOwns = flatten([p.owns for p in noDepSubTasks])
  IF hasDuplicates(allOwns): RETURN "sequential"
  RETURN "parallel"
```

Criteria: >=3 sub-tasks AND >=2 sub-tasks with no deps AND 0 file overlap between dep-free sub-tasks.

## Dependency Graph Construction

```
FUNCTION buildDAG(subTasks):
  nodes = { subTask.id: subTask for each sub-task }
  edges = {}
  FOR subTask IN subTasks:
    FOR dep IN subTask.depends:
      edges[dep] -> subTask.id  # dep must complete before sub-task
  RETURN { nodes, edges }
```

Parse `depends` from each sub-task YAML frontmatter. Missing `depends` = empty list (no deps).

## Parallel Group Identification

Topological sort → assign depth level to each sub-task:

```
FUNCTION groupByDepth(dag):
  depth = {}
  FOR subTask IN topologicalOrder(dag):
    IF subTask.depends == []: depth[subTask] = 0
    ELSE: depth[subTask] = max(depth[dep] for dep in subTask.depends) + 1
  groups = {}
  FOR subTask, d IN depth:
    groups[d].append(subTask)
  RETURN sorted(groups.values())  # [[group0], [group1], ...]
```

Sub-tasks at same depth with no mutual dependencies form a parallel group.

## Dispatch Protocol

For each parallel group:

```
FUNCTION dispatchGroup(group, platformCtx, planDir):
  # Cap concurrent subagents
  batches = chunk(group, size=5)
  FOR batch IN batches:
    # Launch all agents in batch simultaneously (single message = parallel)
    agents = []
    FOR subTask IN batch:
      agents.append(Task(
        subagent_type: "bk-ios-developer",  # substitute bk-android-developer or bk-flutter-developer at runtime
        run_in_background: true,
        description: "Implement sub-task {subTask.id}: {subTask.title}",
        prompt: buildPrompt(subTask, platformCtx, planDir)
      ))
    # Wait for all agents in batch before next batch
    waitAll(agents)
    # Post-group sync for each completed sub-task
    FOR subTask IN batch:
      postSubTaskSync(subTask)
```

Max concurrent: 5 subagents per batch. If group has >5 sub-tasks, queue in batches of 5.

## Agent Prompt (Parallel Variant)

Each parallel agent receives:

```
Task: Implement sub-task {NN} — {title}
Implement sub-task {NN}: {title}
Plan sub-task file: {absolute-path-to-sub-task-file}
Platform context: platform-context.json
Inputs: {plan-dir}/inputs/generation-input.json
File ownership: {owns patterns from YAML} — ONLY modify files matching these globs
Requirements: {reqs list from sub-task YAML}
SRS reference: {plan-dir}/srs.md (if exists)

IMPORTANT — Parallel Mode Rules:
- You are 1 of N agents running concurrently
- ONLY create/modify files listed in File ownership above
- Never touch files outside your owns scope
- Run lint + build after each file
- Update the `## Tasks` checkboxes [ ] → [x] as you complete each
  (never tick `## Edge Cases & Risks` or `## Review Checklist` — those are not progress)
- Report any deviations from Expected Code
- Before returning: verify all created/modified files exist and are non-empty

Output: {plan-dir}/research/impl-sub-task-{NN}.md
  Impl report — markdown with YAML frontmatter. Required frontmatter: schema_type: impl-report,
  agent, feature, sub_task, status, timestamp, build_verified, requirements_satisfied,
  files_changed (min 1: {path, change, description}), skills_loaded.
  Required sections: ## Summary, ## Deviations from Expected Code, ## Edge Cases Addressed,
  ## Anti-Patterns Avoided, ## Notes for Reviewer. Schema: bk-agent-contract §3.
  Write it even when blocked — status: needs_info + info_needed. There is no impl-result.json.
```

## Ownership Enforcement in Parallel

Before dispatching a group, validate no overlap:

```
FUNCTION validateGroupOwnership(group):
  seen = {}
  FOR subTask IN group:
    FOR glob IN subTask.owns:
      IF glob IN seen:
        ERROR "File ownership conflict: {glob} claimed by {seen[glob]} and {subTask.id}"
      seen[glob] = subTask.id
```

Conflict = stop and report to user. Do not dispatch group with conflicts.

## Wait-All Pattern

All agents in a batch must complete before:
- Post-sub-task sync runs for any sub-task in batch
- Next batch or group starts
- Steps 4-6 (Review, Test, Finalize) begin

If an agent hangs beyond reasonable time: escalate to user, do not auto-cancel.

## Post-Group Sync

After each batch completes, for each sub-task in batch (same as sequential post-sub-task sync):

1. **ClaudeTask**: TaskUpdate(completed) for each done task
2. **Checkboxes**: `- [ ]` → `- [x]` in sub-task file
3. **Sub-task status**: if all checkboxes checked → update sub-task YAML `status: complete`
4. **Plan table**: update plan.md sub-task row status
5. **.plan-state.json**: add sub-task to `completedSteps`, write `stepResults[N]`

Each agent syncs only its own sub-task files — no cross-agent file writes.

## Error Handling

```
IF agent fails (error or build failure):
  log: "Sub-task {NN} failed in parallel group"
  AFTER group completes (other agents finish):
    retry sub-task {NN} sequentially (use standard sub-task-execution.md dispatch)
    max 2 retries
    IF still fails after 2 retries: escalate to user, skip sub-task, continue
```

Failed sub-tasks do not block other agents in the same group from completing.

## Metrics

Capture per agent and aggregate for group:

```json
"parallelGroup": {
  "groupIndex": 0,
  "subTasks": ["sub-task-01", "sub-task-03"],
  "startTime": "<iso>",
  "endTime": "<iso>",
  "groupDurationMs": 0,
  "sequentialEquivalentMs": 0,
  "speedupRatio": 0,
  "agents": [
    { "subTask": "sub-task-01", "durationMs": 0, "status": "complete" },
    { "subTask": "sub-task-03", "durationMs": 0, "status": "complete" }
  ]
}
```

`speedupRatio = sequentialEquivalentMs / groupDurationMs` — report at end of Step 3.
