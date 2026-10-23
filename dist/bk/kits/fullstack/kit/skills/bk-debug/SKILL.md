---
name: bk-debug
description: "Bug fix workflow — classify, analyze root cause, code fix, test, review, commit."
user-invocable: true
argument-hint: "[bug description] --auto|--review|--quick"
---

# Fix Bug: $ARGUMENTS

Classifies bug severity, dispatches debugger + parallel scouts for root cause analysis, applies fix
via platform dev agent, verifies with quality agents, and commits.

## Arguments

- `--auto` — Autonomous mode (default): auto-approve if score >= 9.5
- `--review` — Human-in-the-loop: pause for approval at each step
- `--quick` — Quick mode: lower threshold (8.5), 1 fix cycle max

<Use_When>
- User reports a bug, crash, error, or test failure
- User says "fix", "bug", "broken", "crash", "not working"
- Regression after recent changes
</Use_When>

<Do_Not_Use_When>
- New feature needed — use /bk-code
- Code quality improvement — use /bk-refactor
- Code review only — use /bk-review
- Quick question about code behavior — respond directly
</Do_Not_Use_When>

## Complexity Tiers

| Tier | Score | Pipeline |
|------|-------|----------|
| Trivial | 6-10 | classify → dispatch bk-{platform}-developer (single fix) → commit |
| Standard | 11-20 | classify → analyze → code → test → review → commit |
| Complex | 21-30 | classify → analyze → brainstorm → code → test → review → commit |

## Phases

### Phase 1: Classify
Score bug across 6 dimensions (domain, impact, technical, risk, context, skill gap).
Determine tier. Detect platform. Detect issue type and route to specialized workflow.
Trivial shortcut: dispatch bk-{platform}-developer directly (skip analyze and review).

### Foundation Context Loading
Before dispatching the dev agent, read `bk/docs/foundation/architecture.md` (patterns, layer
structure) and `code-guidelines.md` (naming, DI), and put a `Foundation Context:` summary of both
in the dispatch prompt with "Ensure fix follows existing project conventions."

**Issue Type Routing:**

| Type | Keywords | Workflow |
|------|----------|----------|
| Build | `build`, `compile`, `link`, `pod`, `gradle`, `module not found` | `references/workflow-build.md` |
| Device | `device`, `crash on`, `iPhone`, `simulator works but` | `references/workflow-device.md` |
| Performance | `slow`, `leak`, `ANR`, `frame drop`, `OOM`, `jank` | `references/workflow-performance.md` |
| UI | `layout`, `visual`, `style`, `overlap`, `cutoff`, `display` | `references/workflow-ui.md` |
| General | Other | Standard phases below |

Load specialized workflow reference alongside standard phases — it augments, not replaces.

### Xcode MCP Build Error Shortcut

Bug report carries Xcode build error output (xcode-mcp / xcode-build MCP) → skip full classify
scoring, route straight to `references/workflow-build.md`, and set the tier by error scope
(single file → Trivial, multi-file/dependency → Standard, framework/linking → Complex).
Detail: `references/build-error-shortcut.md`

### Complex Tier: Scientific Debate Pattern

For Complex bugs (several possible root causes, unclear reproduction), do NOT investigate
sequentially. Generate 2-3 testable, falsifiable hypotheses, dispatch one agent per hypothesis in
ONE message (each gathers evidence FOR and AGAINST, rates confidence, proposes a fix when
confident), then synthesize: pick the strongest-evidenced hypothesis, or combine insights and run
a targeted follow-up. This avoids the anchoring bias of sequential investigation.
Prompt template + output format: `references/scientific-debate.md`

### Phase 2: Analyze (Standard/Complex)
Dispatch bk-debugger (foreground) + 2-3 Explore scouts (parallel background).
Cross-reference findings. Show root cause + proposed fix.
**Confusion escalation:** If hypotheses conflict or confidence < 70% → `AskUserQuestion` before proceeding.
See: `rules/approval-rules.md` for escalation format and mode behavior.
Complex: add brainstorm + research agents.

### Phase 3: Code
ALL tiers: dispatch `bk-{platform}-developer` agent (opus). DO NOT fix code yourself.
Build error retry: resume agent, max 3 attempts.
**After fix:** parallel verification — see `references/parallel-verification.md`.

### Phase 4: Test (Standard/Complex)
Dispatch `bk-unit-test-agent` / `bk-device-test-agent` background. Standard: unit tests. Complex: + device tests (mobile kits only).

### Phase 5: Review (Standard/Complex)
Mode-aware review cycle. Auto/HITL/Quick modes with score thresholds.
Fix loop: resume `bk-{platform}-developer` with findings. Max 2 cycles (auto), 1 (quick).

### Phase 6: Commit
Show diff summary. Ask approval. Dispatch bk-git-manager.

### Finalize (after commit phase)

Dispatch 3 mandatory agents:
1. bk-project-manager → sync plan checkboxes if plan exists
2. bk-docs-writer → update docs if significant fix
3. bk-git-manager → commit (may already be done in commit phase)

For Trivial tier: skip bk-project-manager (no plan) and bk-docs-writer (minor fix).
For Standard/Complex tier: all 3 mandatory.

## Task Orchestration (Standard/Complex only)

After Phase 1 classify, create Tasks upfront with dependency chains.
Load: `references/task-orchestration.md`
Skip for: Trivial tier (< 3 steps, overhead exceeds benefit).

## Constraints

- Fix loop max: 2 auto / 1 quick (then escalate via `AskUserQuestion`)
- Build failures max: 3 (then escalate via `AskUserQuestion`)
- Trivial bugs: dispatch bk-{platform}-developer for single fix (skip analyze/review, not skip delegation)
- Single-message batching: ALL background agents in ONE message
- State machine: `rules/state-machine.md`
- Approval rules: `rules/approval-rules.md` — defines all escalation checkpoints and `AskUserQuestion` formats
- Parallel verification: `references/parallel-verification.md`

## Reactive Orchestration Reminder

After each agent dispatch returns, check its output for reactive signals. Helper skills
dispatchable at any point: **bk-brainstormer** (stuck on approach / architecture concern),
**bk-docs-seeker** (unknown API or framework error), **bk-sequential-thinking** (complex
decomposition, conflicting data), **bk-problem-solving** (fix loops, breakthrough needed).

**Decision tables:** `rules/reactive-orchestration.md` — **User interaction:** `rules/user-interaction-protocol.md`
