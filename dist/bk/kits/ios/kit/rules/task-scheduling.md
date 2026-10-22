# Task Scheduling & Timeout Rules

## Agent Timeout Standards

All agent dispatches MUST include a timeout expectation. If an agent exceeds its timeout, the conductor should escalate.

| Agent Category | Timeout | Examples |
|---------------|---------|----------|
| Research agents | 5 minutes | bk-researcher, Explore scouts |
| Dev agents | 15 minutes | bk-ios-developer, bk-android-developer, bk-flutter-developer |
| Review agents | 5 minutes | bk-code-reviewer, bk-security-auditor, bk-performance-analyzer |
| Docs agents | 5 minutes | bk-docs-writer |
| Test agents | 10 minutes | bk-unit-test-agent, bk-device-test-agent (mobile kits only) |
| Git agents | 2 minutes | bk-git-manager |
| Planning agents | 10 minutes | bk-planner, bk-test-architect |

## Timeout Handling

When an agent exceeds its timeout:

1. **First timeout**: Wait additional 50% time (e.g., 5min agent → wait until 7.5min)
2. **Second timeout**: Escalate to user with options:
   - **Retry**: Re-dispatch the agent with same prompt
   - **Skip**: Continue workflow without this agent's output
   - **Manual**: User handles this step manually
3. **Never**: Wait indefinitely — always have an upper bound

## Dispatch Protocol

Include timeout expectation in every dispatch prompt:
```
Expected completion: {timeout} minutes
If stuck: save partial progress to output file, report what's blocking
```

## Parallel Dispatch Timing

When dispatching multiple agents in parallel:
- Use the LONGEST timeout among dispatched agents as the wait ceiling
- If any agent completes early, don't wait for the full ceiling — check remaining agents
- If all-but-one complete and the remaining agent exceeds 2x its timeout, escalate

Agent timeout triggers reactive signal per `agent-signal-detector.cjs`. See `reactive-orchestration.md`.
