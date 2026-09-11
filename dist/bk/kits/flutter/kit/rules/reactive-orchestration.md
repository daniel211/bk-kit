# Reactive Orchestration Protocol

> Conductor MUST read this rule after every agent return.
> You are an intelligent conductor, not a static pipeline executor.

---

## 1. Core Principle

After EVERY agent dispatch returns:
1. Read agent output
2. Check for reactive signals (see §2)
3. If signal detected → execute reactive action (see §3)
4. If no signal → continue normal pipeline

**Do NOT blindly continue pipeline when agents report issues.**

---

## 2. Reactive Signal Detection

### Signal Patterns in Agent Output

| Signal | Trigger Patterns in Output | Priority |
|--------|---------------------------|----------|
| `agent_stuck` | "cannot determine", "unable to identify", "stuck", "blocked", retry >= 2 | HIGH |
| `unknown_api` | "unknown API", "unknown framework", "unfamiliar method", API error with no docs | HIGH |
| `confidence_low` | "confidence: low", confidence < 70%, "uncertain", "not sure" | HIGH |
| `conflicting_results` | "conflicting", "contradicting", "disagree", 2+ sources oppose | MEDIUM |
| `architecture_concern` | "architecture violation", "pattern mismatch", "breaking change" | MEDIUM |
| `performance_issue` | "performance critical", "severe bottleneck", "main thread blocking" | MEDIUM |
| `build_fail_repeated` | Build error after 2+ retries with same error pattern | HIGH |
| `fix_loop_stuck` | Same phase entered 3+ times (coding→review→coding cycle) | HIGH |
| `mcp_timeout` | MCP tool timeout > 10s or connection refused | LOW (auto-handled) |
| `context_high` | Context window > 80% capacity | LOW (auto-handled) |

### Detection Method

Signals are detected two ways:
1. **Hook-level** (automatic): `agent-signal-detector.cjs` parses output, injects `[REACTIVE-SIGNAL]` into conductor context
2. **Conductor-level** (manual): Conductor reads agent output and recognizes patterns above

---

## 3. Escalation Routing Table

### When Signal Detected → Do This

| Signal | Action 1 (try first) | Action 2 (if action 1 fails) | Action 3 (last resort) |
|--------|---------------------|------------------------------|------------------------|
| `agent_stuck` | Dispatch bk-brainstormer with current error context | Dispatch bk-problem-solving (Inversion Exercise) | AskUserQuestion |
| `unknown_api` | Dispatch bk-docs-seeker for framework/API docs | Agent uses WebSearch as fallback | AskUserQuestion |
| `confidence_low` | Dispatch bk-sequential-thinking for step-by-step analysis | — | AskUserQuestion |
| `conflicting_results` | Dispatch bk-sequential-thinking to evaluate both sides | Dispatch bk-brainstormer for alternative | AskUserQuestion |
| `architecture_concern` | Suggest to user: "Dispatch brainstormer for refactor approach?" | Dispatch bk-brainstormer if user approves | AskUserQuestion |
| `performance_issue` | Dispatch bk-brainstormer for optimization approach | Dispatch bk-analyze for deeper analysis | AskUserQuestion |
| `build_fail_repeated` | Load bk-problem-solving skill, try Simplification Cascades | Dispatch bk-docs-seeker for build tool docs | AskUserQuestion |
| `fix_loop_stuck` | Dispatch bk-problem-solving (creative breakthrough) | Dispatch bk-brainstormer for different approach | AskUserQuestion |
| `mcp_timeout` | Auto-switch to fallback (see §6) | — | — |
| `context_high` | Suggest /compact, defer non-critical agents | — | — |

### Escalation Limits

- Max 2 reactive dispatches per signal (prevent infinite loops)
- If 2 helper skills fail to resolve → MUST AskUserQuestion
- Reactive dispatches do NOT reset the main workflow retry counter

---

## 4. Cross-Skill Trigger Protocol

### Conductor CAN dispatch any helper skill at ANY point in ANY workflow.

This is NOT limited to predefined pipeline stages.

**Valid examples:**
- During bk-code Phase 3 → dev agent confused about API → conductor dispatches bk-docs-seeker → feeds result back to dev agent
- During bk-debug Standard → 2 retries fail → conductor dispatches bk-brainstormer → resume debug with new approach
- During bk-plan research → researchers conflict → conductor dispatches bk-sequential-thinking → synthesize

**Forbidden:**
- Do NOT dispatch bk-code/bk-debug/bk-plan from within each other (recursion)
- Do NOT dispatch 2 agents editing the same file (file ownership)
- Do NOT escalate more than 2 levels without AskUserQuestion

### Handoff Protocol

When dispatching a reactive helper skill:

1. **Context to include:**
   - Current agent's last output (error/report)
   - Current workflow phase and feature name
   - What has been tried and failed (retry history)

2. **Helper output path:**
   - Write to `bk/dev/shared/reactive/{signal}-{feature}.md`

3. **Resume main workflow:**
   - Read helper output
   - If helper provides solution → inject into main agent's next prompt
   - If helper says "need more info" → AskUserQuestion
   - If helper fails → next escalation level

---

## 5. Skill Trigger Registry

| Signal | Primary Skill | Expected Time | What to Include in Dispatch |
|--------|--------------|---------------|---------------------------|
| `agent_stuck` | bk-brainstormer | 3-5 min | Current error, what was tried, codebase context |
| `agent_stuck` (fallback) | bk-problem-solving | 3-5 min | Error history, suggest Inversion Exercise |
| `unknown_api` | bk-docs-seeker | 1-2 min | Framework name, API method, error message |
| `confidence_low` | bk-sequential-thinking | 2-3 min | Decision to make, available options, constraints |
| `conflicting_results` | bk-sequential-thinking | 2-3 min | Both sources, points of disagreement |
| `architecture_concern` | bk-brainstormer | 3-5 min | Review findings, current architecture.md |
| `build_fail_repeated` | bk-problem-solving | 3-5 min | Build errors, what fixes were attempted |
| `fix_loop_stuck` | bk-problem-solving | 3-5 min | Fix history, suggest Simplification Cascades |

---

## 6. MCP Fallback Chain (Auto-Triggered)

| MCP | Timeout/Error | Immediate Fallback | Notification |
|-----|--------------|-------------------|--------------|
| Serena | > 10s or refused | Grep/Glob per coding-intelligence-priority.md | "Serena unavailable, using text search" |
| xcode-mcp | Timeout | xcodebuild CLI via Bash | "Using CLI build" |
| xcode-build | Timeout | xcodebuild CLI via Bash | "Using CLI build" |
| Figma | Auth error | AskUserQuestion for manual JSON export | "Figma access issue" |
| Figma | Timeout | Retry once, then AskUserQuestion | "Figma slow" |

MCP fallback is handled automatically by `mcp-health-monitor.cjs` hook.
Conductor does NOT need to manually manage MCP failures.

---

## 7. Integration with Existing Rules

- **conductor-role.md** → References this file for reactive decision making
- **approval-rules.md** → AskUserQuestion format defined in user-interaction-protocol.md
- **state-machine.md** → Phase re-entry detection triggers fix_loop_stuck signal
- **task-scheduling.md** → Agent timeout triggers reactive signal
- **coding-intelligence-priority.md** → MCP fallback chain aligned with priority levels

---

## 8. Skill Handoff Protocol (Detailed)

### Reactive Output Path

All reactive helper skill outputs go to:
```
bk/dev/shared/reactive/{signal}-{feature}-{YYMMDD-HHMM}.md
```

Example: `bk/dev/shared/reactive/agent_stuck-payment-login-260325-1400.md`

### Handoff Steps

#### Step 1: Conductor Prepares Context
```
Collect from current workflow:
- Last agent output (error message, report)
- Current phase name + feature name
- Retry history (what was attempted, what failed)
- Relevant file paths
```

#### Step 2: Dispatch Helper Skill
```
Task: {describe what help is needed}
Signal: {signal that triggered this dispatch}
Context:
  - Current phase: {phase}
  - Feature: {feature}
  - Error: {last error or issue}
  - Tried: {list of attempted approaches}
Output: bk/dev/shared/reactive/{signal}-{feature}.md
Expected: {what kind of result is needed — approach, docs, analysis}
```

#### Step 3: Read Result & Resume
- If helper provides clear solution → inject into main agent's next dispatch prompt as additional context
- If helper says "need more info" → AskUserQuestion with helper's questions
- If helper returns no useful result → escalate to next level per §3

### Context Passing Template

When resuming main workflow agent after reactive helper:
```
Resume task with additional context from reactive analysis:

[REACTIVE INSIGHT from bk-brainstormer]
{summary of brainstormer recommendation}

Previous approach failed because: {reason from helper analysis}
Recommended new approach: {specific approach from helper}
Files to focus on: {file paths from helper}

Continue with: {original task description}
```
