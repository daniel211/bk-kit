# Skill Activation Matrix

## Always Activate

| Agent/Skill | Reason |
|-------------|--------|
| bk-debugger | Core to all non-Trivial fix workflows |

## By Complexity Tier

| Tier | Agents Activated |
|------|------------------|
| Trivial | None (main session fixes directly) |
| Standard | bk-debugger → bk-{platform}-developer → bk-unit-test-agent → bk-code-reviewer |
| Complex | All Standard + bk-brainstormer + bk-researcher + bk-security-auditor + bk-performance-analyzer + bk-device-test-agent |

## Parallel Patterns

| When | Strategy |
|------|----------|
| Analyze phase | bk-debugger + 2-3 Explore scouts (parallel) |
| After code phase | Bash agents: build + lint (parallel) |
| Test phase | bk-unit-test-agent [+ bk-device-test-agent] (parallel) |
| Review phase (Complex) | bk-code-reviewer + bk-security-auditor + bk-performance-analyzer (parallel) |
| Complex analyze | bk-brainstormer + bk-researcher (parallel) |

## Conditional Skills

| Trigger | Skill |
|---------|-------|
| Stuck on approach | Consider alternative analysis methods |
| UI/visual bug | Use screenshots + visual verification |
| Architecture concern | Dispatch bk-brainstormer for trade-off analysis |
| External docs needed | Dispatch bk-researcher |

## Model Routing

| Agent Category | Model | Reason |
|----------------|-------|--------|
| Platform dev (foreground) | opus | Full MCP/LSP coding |
| Planning (bk-planner) | opus | Complex reasoning |
| Quality/test (background) | sonnet | Pattern matching, test writing |
| Ops (bk-git-manager) | haiku | Lightweight commit ops |
