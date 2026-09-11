# MK Agent Teams — Best Practices

## Decision Matrix: Teams vs Subagents

| Scenario | Use | Reason |
|----------|-----|--------|
| Single feature, one platform | Subagents | No parallelism benefit |
| Sequential plan→code→test | Subagents | Dependencies prevent parallelism |
| 3+ independent features simultaneously | **Teams** | True parallel context windows |
| Competing debug hypotheses | **Teams** | Adversarial discussion impossible with subagents |
| Multi-platform (iOS + Android + Flutter) | **Teams** | Isolated platform context per agent |
| Code review with different lenses | **Teams** | Independent analysis avoids anchoring |
| Research only | Subagents | Read-only, low coordination cost |
| Token budget tight (<200K remaining) | Subagents | Teams multiply token usage |
| Single agent would finish in <5 min | Subagents | Coordination overhead not worth it |

**Rule of thumb:** Use teams when agents need to work independently AND either discuss findings or truly parallelize non-overlapping work.

## Token Budget by Template

| Template | Agents | Est. Tokens | Model Routing |
|----------|--------|-------------|---------------|
| dev (2 devs + tester) | 3 | ~400K-800K | opus for bk-{platform}-developer, sonnet for bk-unit-test-agent |
| dev (4 devs + tester) | 5 | ~800K-1.6M | opus for devs, sonnet for tester |
| debug (3 debuggers) | 3 | ~200K-400K | sonnet for all bk-debugger |
| review (3 reviewers) | 3 | ~100K-200K | sonnet for all bk-code-reviewer |

Agent Teams use significantly more tokens than subagents. Only use when parallel exploration or discussion adds clear value.

## Team Sizing

| Template | Default N | Increase when | Decrease when |
|----------|-----------|---------------|---------------|
| dev | 2 | >3 independent feature areas | Features share core models/navigation |
| debug | 3 | Issue has many possible root causes | Issue is clearly isolated to one subsystem |
| review | 3 | Large PR (>500 lines), multi-layer changes | Small focused change (<100 lines) |

## Platform-Aware Dispatch

Detect platform before spawning dev agents:

1. Check plan frontmatter: `platform: ios|android|flutter`
2. Fall back to `platform-context.json` in project root
3. Fall back to asking user

Agent mapping:
- `ios` → `subagent_type: "bk-ios-developer"`
- `android` → `subagent_type: "bk-android-developer"`
- `flutter` → `subagent_type: "bk-flutter-developer"`
- tester (all platforms) → `subagent_type: "bk-unit-test-agent"`
- debugger (all) → `subagent_type: "bk-debugger"`
- reviewer (all) → `subagent_type: "bk-code-reviewer"`

## Worktree Strategy

Use git worktrees for dev template when N >= 2:

```bash
# Setup (lead does this before spawning devs)
git worktree add ../worktrees/dev-1 -b feature/dev-1-<slug>
git worktree add ../worktrees/dev-2 -b feature/dev-2-<slug>

# Each dev works in their worktree — no git conflicts possible
# Lead merges after completion
git merge feature/dev-1-<slug>
git merge feature/dev-2-<slug>

# Cleanup
git worktree remove ../worktrees/dev-1
git worktree remove ../worktrees/dev-2
```

When NOT to use worktrees: review and debug templates (read-heavy, no parallel writes).

## Error Recovery Patterns

### Redirect (first resort)
```
SendMessage(type: "message", recipient: "dev-1", content: "You are editing Views/Home/ which is owned by dev-2. Stop and focus on Views/Login/ only.")
```

### Replace (teammate failed or stuck)
1. `SendMessage(type: "shutdown_request", recipient: "<stuck-teammate>")`
2. `TaskUpdate(taskId: <task-id>, status: "pending")` — reset task
3. Spawn new teammate for same task with revised prompt

### Reassign (unblock dependents)
```
TaskUpdate(taskId: <blocked-task>, removeBlockedBy: [<failed-task-id>])
```
Use when a dev's task is abandoned and tester must proceed with partial implementation.

## Anti-Patterns

- **Using teams for single-agent tasks** — coordination overhead exceeds benefit
- **Research-only tasks** — use subagents, no peer discussion needed
- **Sequential chains** — plan→code→test has dependencies; subagents are cheaper
- **Spawning teams for <3 parallel workstreams** — threshold for team value
- **No file ownership defined** — always define explicit ownership in dev template
- **Lead implementing while devs work** — lead coordinates only, does not edit files
- **Forgetting MK Context Block** — teammates won't know project paths, platform, branch
- **Using teams when token budget is near limit** — each teammate starts fresh context window

## Context Injection Checklist

Every teammate spawn prompt MUST include:
- [ ] Task description with acceptance criteria
- [ ] File ownership glob patterns (dev template only)
- [ ] MK Context Block (work dir, platform, foundation path, reports path, branch)
- [ ] Teammate names for SendMessage coordination
- [ ] `team_name` parameter on Task call

## Monitoring

- TaskCompleted events auto-notify when tasks finish — no manual polling
- TeammateIdle events indicate teammate awaiting input
- Fallback: Check `TaskList` if no event in 60s
- If stuck >5 min: `SendMessage` directly to teammate
- If unresponsive after message: use Replace pattern above
