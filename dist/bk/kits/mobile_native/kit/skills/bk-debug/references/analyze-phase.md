# Analyze Phase (Standard/Complex)

Transition: `classify → analyze`

## Dispatch Pattern

Launch ALL agents in ONE message:

### 1. bk-debugger (foreground)

```
Task(subagent_type: "bk-debugger", prompt: "
  Bug description: {description}
  Platform: {platform}
  Recent commits: {git_log}
  Platform context: {from platform-context.json}
  Output: bk/dev/shared/reports/debug-analysis-{feature}.json

  Apply 5 Whys analysis. Identify exact file + line. Propose fix approach.
")
```

### 2. Parallel Explore Scouts (background)

Spawn 2-3 Explore agents to verify hypothesis from different angles:

```
Task(subagent_type: "Explore", run_in_background: true, prompt: "
  Find error patterns related to: {error_message}
  Search in: {suspected_modules}
  Report: affected files, similar patterns, related code
", description: "Scout error patterns")

Task(subagent_type: "Explore", run_in_background: true, prompt: "
  Find recent changes (last 10 commits) touching: {affected_files}
  Check if regression introduced by recent commit
", description: "Scout recent changes")
```

Optional third scout (if cross-module):
```
Task(subagent_type: "Explore", run_in_background: true, prompt: "
  Find dependencies and consumers of: {affected_module}
  Map impact radius
", description: "Scout dependencies")
```

## Cross-Reference Verification

After all agents return:
1. Read bk-debugger root cause from `debug-analysis-{feature}.json`
2. Compare with Explore findings
3. **High confidence**: multiple sources agree on root cause → proceed
4. **Low confidence**: findings contradict → present both to user, ask which to pursue

## Analysis Gate

Show to user:
- Affected files (from debugger + scouts)
- Root cause (1-2 sentences)
- Proposed fix approach
- Confidence level (high/low)

Ask approval before coding (Standard/Complex).

## Complex Tier: Brainstorm + Research

If `complexity_tier == "Complex"`, after analysis gate approval, dispatch in ONE message:

```
Task(subagent_type: "bk-brainstormer", model: "sonnet", run_in_background: true, prompt: "
  Bug: {description}
  Root cause: {from debugger}
  Platform: {platform}
  Evaluate fix approaches:
  1. Quick patch (minimal change)
  2. Proper fix (address root cause)
  3. Refactor approach (if architecture issue)
  Trade-offs: risk, effort, maintainability, performance
  Output: bk/dev/shared/reports/brainstorm-{feature}.md
")

Task(subagent_type: "bk-researcher", model: "sonnet", run_in_background: true, prompt: "
  Research: {root_cause_area}
  Platform: {platform}
  Find: security advisories, known issues, best practices, platform docs
  Output: bk/dev/shared/reports/research-{feature}.md
")
```

After brainstorm + research return:
- Present trade-off analysis to user
- User selects approach
- Proceed to code phase

## State Output

On approval: write `fix_guidance` and transition to `.workflow-state.json`:
```json
{
  "current_phase": "analyze",
  "fix_guidance": "{approved approach}",
  "brainstorm_complete": true|false,
  "research_complete": true|false
}
```
