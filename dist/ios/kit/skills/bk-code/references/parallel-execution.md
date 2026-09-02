# Parallel Execution (Step 3 — Parallel Mode)

Full algorithm for dispatching bk-{platform}-developer agents in parallel groups (platform detected at runtime).

## Mode Detection

Execution mode is resolved by intent-detection.md. This file is loaded only when
`execution == "parallel"`. If `execution == "sequential"`, use standard phase-execution.md loop.

## Auto-Detection Algorithm

When plan frontmatter has `execution: auto`:

```
FUNCTION autoDetect(phases):
  IF len(phases) < 3: RETURN "sequential"
  noDepPhases = phases WHERE depends == [] OR depends absent
  IF len(noDepPhases) < 2: RETURN "sequential"
  # Check for file overlap between no-dep phases
  allOwns = flatten([p.owns for p in noDepPhases])
  IF hasDuplicates(allOwns): RETURN "sequential"
  RETURN "parallel"
```

Criteria: >=3 phases AND >=2 phases with no deps AND 0 file overlap between dep-free phases.

## Dependency Graph Construction

```
FUNCTION buildDAG(phases):
  nodes = { phase.id: phase for each phase }
  edges = {}
  FOR phase IN phases:
    FOR dep IN phase.depends:
      edges[dep] -> phase.id  # dep must complete before phase
  RETURN { nodes, edges }
```

Parse `depends` from each phase YAML frontmatter. Missing `depends` = empty list (no deps).

## Parallel Group Identification

Topological sort → assign depth level to each phase:

```
FUNCTION groupByDepth(dag):
  depth = {}
  FOR phase IN topologicalOrder(dag):
    IF phase.depends == []: depth[phase] = 0
    ELSE: depth[phase] = max(depth[dep] for dep in phase.depends) + 1
  groups = {}
  FOR phase, d IN depth:
    groups[d].append(phase)
  RETURN sorted(groups.values())  # [[group0], [group1], ...]
```

Phases at same depth with no mutual dependencies form a parallel group.

## Dispatch Protocol

For each parallel group:

```
FUNCTION dispatchGroup(group, platformCtx, planDir):
  # Cap concurrent subagents
  batches = chunk(group, size=5)
  FOR batch IN batches:
    # Launch all agents in batch simultaneously (single message = parallel)
    agents = []
    FOR phase IN batch:
      agents.append(Task(
        subagent_type: "bk-ios-developer",  # substitute bk-android-developer or bk-flutter-developer at runtime
        model: "opus",
        run_in_background: true,
        description: "Implement phase {phase.id}: {phase.title}",
        prompt: buildPrompt(phase, platformCtx, planDir)
      ))
    # Wait for all agents in batch before next batch
    waitAll(agents)
    # Post-group sync for each completed phase
    FOR phase IN batch:
      postPhaseSync(phase)
```

Max concurrent: 5 subagents per batch. If group has >5 phases, queue in batches of 5.

## Agent Prompt (Parallel Variant)

Each parallel agent receives:

```
Task: Implement phase {N} — {title}
Implement phase {N}: {title}
Plan phase file: {absolute-path-to-phase-file}
Platform context: platform-context.json
Inputs: {plan-dir}/inputs/generation-input.json
File ownership: {owns patterns from YAML} — ONLY modify files matching these globs
Requirements: {reqs list from phase YAML}
SRS reference: {plan-dir}/srs.md (if exists)

IMPORTANT — Parallel Mode Rules:
- You are 1 of N agents running concurrently
- ONLY create/modify files listed in File ownership above
- Never touch files outside your owns scope
- Run lint + build after each file
- Update Tasks checkboxes [ ] → [x] as you complete each
- Report any deviations from Expected Code
- Before returning: verify all created/modified files exist and are non-empty

Output: {plan-dir}/research/impl-phase-{N}.md
```

## Ownership Enforcement in Parallel

Before dispatching a group, validate no overlap:

```
FUNCTION validateGroupOwnership(group):
  seen = {}
  FOR phase IN group:
    FOR glob IN phase.owns:
      IF glob IN seen:
        ERROR "File ownership conflict: {glob} claimed by {seen[glob]} and {phase.id}"
      seen[glob] = phase.id
```

Conflict = stop and report to user. Do not dispatch group with conflicts.

## Wait-All Pattern

All agents in a batch must complete before:
- Post-phase sync runs for any phase in batch
- Next batch or group starts
- Steps 4-6 (Review, Test, Finalize) begin

If an agent hangs beyond reasonable time: escalate to user, do not auto-cancel.

## Post-Group Sync

After each batch completes, for each phase in batch (same as sequential post-phase sync):

1. **ClaudeTask**: TaskUpdate(completed) for each done task
2. **Checkboxes**: `- [ ]` → `- [x]` in phase file
3. **Phase status**: if all checkboxes checked → update phase YAML `status: complete`
4. **Plan table**: update plan.md phase row status
5. **.plan-state.json**: add phase to `completedSteps`, write `stepResults[N]`

Each agent syncs only its own phase files — no cross-agent file writes.

## Error Handling

```
IF agent fails (error or build failure):
  log: "Phase {N} failed in parallel group"
  AFTER group completes (other agents finish):
    retry phase {N} sequentially (use standard phase-execution.md dispatch)
    max 2 retries
    IF still fails after 2 retries: escalate to user, skip phase, continue
```

Failed phases do not block other agents in the same group from completing.

## Metrics

Capture per agent and aggregate for group:

```json
"parallelGroup": {
  "groupIndex": 0,
  "phases": ["phase-01", "phase-03"],
  "startTime": "<iso>",
  "endTime": "<iso>",
  "groupDurationMs": 0,
  "sequentialEquivalentMs": 0,
  "speedupRatio": 0,
  "agents": [
    { "phase": "phase-01", "durationMs": 0, "status": "complete" },
    { "phase": "phase-03", "durationMs": 0, "status": "complete" }
  ]
}
```

`speedupRatio = sequentialEquivalentMs / groupDurationMs` — report at end of Step 3.
