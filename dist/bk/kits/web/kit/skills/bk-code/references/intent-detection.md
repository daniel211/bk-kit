# Intent Detection

Parse `$ARGUMENTS` to determine execution mode, execution strategy, and target.

## Parse Algorithm

```
FUNCTION detectIntent(args):
  # 1. Extract quality-mode flags
  IF args contains "--fast": mode = "fast"
  ELSE IF args contains "--no-review": mode = "no-review"
  ELSE: mode = "full"

  # 2. Extract execution strategy flags (override plan frontmatter)
  IF args contains "--parallel": executionOverride = "parallel"
  ELSE IF args contains "--sequential": executionOverride = "sequential"
  ELSE: executionOverride = null

  # 3. Detect target
  IF args matches "sub-task-NN-*.md":
    target = "single-sub-task"
    path = resolved sub-task file
  ELSE IF args matches "plan.md" OR is directory:
    target = "full-plan"
    path = resolved plan.md
  ELSE:
    ERROR "No valid plan path found"

  # 4. Resolve execution strategy
  IF executionOverride != null:
    execution = executionOverride  # flag wins over frontmatter
  ELSE IF target == "full-plan":
    execution = readPlanFrontmatter(path).execution ?? "sequential"
    IF execution == "auto": execution = autoDetect(path)
  ELSE:
    execution = "sequential"  # single sub-task always sequential

  RETURN { mode, execution, target, path }
```

## Execution Strategy Resolution

Priority (highest first):
1. `--parallel` / `--sequential` CLI flag
2. `execution:` field in plan.md YAML frontmatter
3. Default: `sequential`

### Frontmatter Values

| Value | Behavior |
|-------|----------|
| `parallel` | Auto-parallel via dependency grouping |
| `sequential` | Force sequential (current default) |
| `auto` | Run auto-detection algorithm (see parallel-execution.md) |
| (absent) | Default to `sequential` |

## Mode Behaviors

| Mode | Test (Step 4) | Review (Step 5) | Use Case |
|------|---------------|-----------------|----------|
| full | Yes | Yes | Standard feature implementation |
| fast | Skip | Skip | Quick fix, hotfix, trivial change |
| no-review | Yes | Skip | Trusted code, time pressure |

## Target Behaviors

| Target | Sub-tasks | Dependencies | Quality Loop |
|--------|-----------|--------------|-------------|
| full-plan | All sub-tasks in batch order | Enforced | Per mode |
| single-sub-task | Only the specified sub-task | Skipped (user chose explicitly) | Per mode |

## Combinations

| Invocation | Mode | Execution | Notes |
|------------|------|-----------|-------|
| `/bk-code plan.md` | full | from frontmatter | standard |
| `/bk-code plan.md --parallel` | full | parallel | force parallel |
| `/bk-code plan.md --sequential` | full | sequential | override frontmatter |
| `/bk-code plan.md --fast --parallel` | fast | parallel | fast + parallel groups |
| `/bk-code sub-task-02-login.md --fast` | fast | sequential | single sub-task always sequential |

## Output

After detection, log:
```
Mode: {full|fast|no-review} | Execution: {parallel|sequential} | Target: {full-plan|single-sub-task} | Path: {resolved path}
```
