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
Before dispatching the dev agent, load foundation context:
1. Read `mk/docs/foundation/architecture.md` — extract architecture patterns, layer structure
2. Read `mk/docs/foundation/code-guidelines.md` — extract naming conventions, DI patterns
3. Include foundation summary in dev agent dispatch prompt:
   ```
   Foundation Context:
   - Architecture: {summary from architecture.md}
   - Naming: {summary from code-guidelines.md}
   - Ensure fix follows existing project conventions.
   ```

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

If bug report contains Xcode build error output (from xcode-mcp or xcode-build MCP):
1. Parse error type from diagnostics:
   - Syntax error → route to `workflow-build.md`
   - Type mismatch → route to `workflow-build.md`  
   - Missing import → route to `workflow-build.md`
   - Linking error → route to `workflow-build.md`
2. Skip full classify scoring — use build error classification directly
3. Set tier based on error scope:
   - Single file error → Trivial
   - Multi-file / dependency error → Standard
   - Framework-level / linking → Complex

> This shortcut saves ~30% classify time for build errors with clear diagnostics.

### Complex Tier: Scientific Debate Pattern

For bugs classified as **Complex** (multiple possible root causes, unclear reproduction):

**Instead of sequential investigation, use parallel hypothesis testing:**

1. **Generate Hypotheses** (conductor analyzes symptoms)
   - List 2-3 possible root causes based on error evidence
   - Each hypothesis should be testable and falsifiable

2. **Dispatch Hypothesis Agents** (parallel, in ONE message)
   - Agent A: Investigate hypothesis 1 — e.g., "Root cause is threading race condition in X"
   - Agent B: Investigate hypothesis 2 — e.g., "Root cause is state corruption in Y"  
   - Agent C (optional): Investigate hypothesis 3
   
   Each agent's prompt:
   ```
   Task: Investigate hypothesis: "{hypothesis}"
   
   Instructions:
   1. Gather evidence FOR this hypothesis
   2. Gather evidence AGAINST this hypothesis
   3. Rate confidence: high/medium/low
   4. If confidence is high, propose specific fix
   
   Output: mk/dev/shared/reports/debug-hypothesis-{N}-{feature}.md
   
   Format:
   ## Hypothesis: {hypothesis}
   ### Evidence FOR
   - {evidence with file:line}
   ### Evidence AGAINST
   - {evidence with file:line}
   ### Confidence: {high|medium|low}
   ### Proposed Fix (if high confidence)
   - {specific fix with file:line:change}
   ```

3. **Evaluate Results** (conductor synthesizes)
   - Compare evidence from all agents
   - Select hypothesis with strongest evidence
   - If no clear winner, combine insights and run targeted follow-up
   
4. **Dispatch Fix** based on winning hypothesis

> This pattern avoids anchoring bias from sequential investigation.
> Multiple agents actively trying to disprove each other produces higher-quality diagnosis.
> Per Anthropic Claude Deep Dive: "Scientific Debate Pattern — spawn multiple agents with
> different hypotheses and have them actively try to disprove each other."

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
Dispatch `bk-unit-test-agent` / `bk-device-test-agent` background. Standard: unit tests. Complex: + device tests.

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

This skill operates within the reactive orchestration framework.
After each agent dispatch and return, check output for reactive signals.

**Helper skills available for dispatch at any point in this workflow:**
- **bk-brainstormer** — agent stuck on approach, architecture concern
- **bk-docs-seeker** — unknown API/framework error
- **bk-sequential-thinking** — complex decomposition, conflicting data
- **bk-problem-solving** — creative breakthrough needed, fix loops

**Decision tables:** `rules/reactive-orchestration.md`
**User interaction:** `rules/user-interaction-protocol.md`
