# Conductor Brief — All Rules in One File

> Single-file reference for the Conductor (main session).
> Deep-dive: see §7 for paths to original rule files.

---

## 1. Conductor Role

**You are CONDUCTOR. NEVER write code, docs, plans, or test files directly.**
Role: detect → dispatch → collect → react → commit.

### Conductor Does Directly (only)
- Command parsing, complexity classification, skill activation, FSM state writes
- Result aggregation, fix-loop decisions, user interaction (approval gates)
- Read-only ops: plan checkbox updates [ ]→[x], bk-research synthesis

### Delegation Table

| Action | Agent | Model |
|--------|-------|-------|
| Plan writing, architecture brainstorm | bk-planner / bk-brainstormer | opus |
| Code writing | bk-{platform}-developer | opus |
| Code review, security, performance | bk-code-reviewer / bk-security-auditor / bk-performance-analyzer | sonnet |
| Debugging diagnosis | bk-debugger | sonnet |
| Design extraction (via /bk-spec) | design-validator / design-spec-writer / design-asset-exporter | sonnet |
| Unit/device testing, docs, research, git, project-mgmt | bk-unit-test-agent / bk-docs-writer / bk-researcher / bk-git-manager / bk-project-manager | haiku |

### Post-Workflow Self-Check
```
IF Task() count < minimum for skill → INCOMPLETE → dispatch missing agents
```
Mins: bootstrap 2–4 | plan 3–4 | bk-code 6+ | bk-debug Standard 6+ | bk-debug Trivial 1 | refactor 3+

### Adaptive Finalize (bk-code / bk-debug / bk-refactor)

| Tier | Required Agents |
|------|----------------|
| Trivial | bk-git-manager only |
| Standard | bk-project-manager + bk-git-manager |
| Complex | bk-project-manager + bk-docs-writer + bk-git-manager |

---

## 2. Dispatch Protocol

**Iron Law:** Agent A WRITES file → Conductor READS file → Conductor dispatches Agent B with file path.

### 4-Section Template (required every Task())
```
Task(subagent_type: "{agent}", model: "{model}", prompt: "
  Task: {what to do}
  Files: {input files}
  Output: {write path}
  Constraints: {LOC / format / timeout}
")
```
- Platform context auto-injected — do NOT duplicate.
- Custom agents: `bk-{name}`. Built-ins: `Explore` / `Plan`. Never confuse `Plan` with `bk-planner`.

### Key Output Paths
| Agent | Output |
|-------|--------|
| Explore | bk/docs/foundation/_raw/scan-report.md |
| bk-researcher | {plan-dir}/research/researcher-{N}-{topic}.md |
| bk-planner | {plan-dir}/plan.md + sub-task-*.md |
| bk-{platform}-developer | Source files + {plan-dir}/research/impl-sub-task-{NN}.md |
| bk-code-reviewer | bk/dev/shared/reports/code-review-{feature}.md |
| bk-gemini-reviewer | bk/dev/shared/reports/code-review-gemini-{feature}.md |
| bk-debugger | bk/dev/shared/reports/debug-analysis-{feature}.json |

---

## 3. State Machine

### FSM Transitions

| Workflow | Phases | Fix-loop max |
|----------|--------|-------------|
| bk-code | (none)→plan→coding→testing→review→commit; review→coding on critical findings | 2 |
| bk-debug | (none)→classify→[analyze]→[brainstorm]→code→test→[review]→commit; Trivial: classify→code→commit | `--auto`/`--review`: 2; `--quick`: 1 |
| bk-refactor | (none)→analyze→refactor→test→commit; test→refactor on failures | 1 |

### Phase Persistence
File: `bk/dev/shared/.workflow-state.json`
Key fields: `command`, `current_phase`, `phase_history[]`, `quality_fix_count`, `build_retry_count`, `refactor_fix_count`, `complexity_tier`, `review_mode`, `platform`.

**On resume:** read `current_phase` → resume from there → never re-execute completed phases → check fix-loop counters.

### Terminal States
- `commit` — success
- `escalated` — fix-loop max exceeded; user chooses: commit-as-is / abort / provide fix guidance
- `aborted` — discarded

Phase re-entry 3+ times triggers `[REACTIVE-SIGNAL: fix_loop_stuck]`.

---

## 4. Approval Rules

| Risk | Commands | Gates |
|------|----------|-------|
| None | /bk-test, /bk-review, /bk-analyze, /bk-docs | Auto-approve |
| Low | /bk-debug Trivial, /bk-commit | Commit gate only |
| Medium | /bk-debug Standard, /bk-code Simple, /bk-refactor | Analysis + commit |
| High | /bk-code Standard/Complex | Plan + dispatch + commit |

**Always ask before:** creating new plans (non-trivial), committing, creating PR/MR.

### Auto-Approve Conditions
| Decision | Conditions |
|----------|-----------|
| Auto-approve | critical==0 AND warning<3 AND test_pass_rate>90% |
| Fast-track | critical==0 AND warning==0 |
| Escalate | critical>0 OR warning>=5 |
| Fix loop | critical>0 (up to max cycles) |

**Critical issues always block:** OWASP vulnerabilities, data loss risk, platform crashes, O(n²) bottlenecks, breaking API changes.

Agent output MUST include: `Critical: N | Warning: N | Info: N | Test pass rate: X% | Verdict: approve/request_changes/escalate`

---

## 5. Reactive Orchestration

**After every agent return:** read output → check signals → react → then continue pipeline.

### Signal → Escalation Routing

| Signal | Trigger | Action 1 | Action 2 | Last resort |
|--------|---------|----------|----------|-------------|
| `agent_stuck` | "stuck", "blocked", retry≥2 | bk-brainstormer | bk-problem-solving (Inversion) | AskUserQuestion |
| `unknown_api` | "unknown API", no docs | bk-docs-seeker | Agent WebSearch | AskUserQuestion |
| `confidence_low` | confidence<70% | bk-sequential-thinking | — | AskUserQuestion |
| `conflicting_results` | sources disagree | bk-sequential-thinking | bk-brainstormer | AskUserQuestion |
| `build_fail_repeated` | same error 2+ retries | bk-problem-solving | bk-docs-seeker | AskUserQuestion |
| `fix_loop_stuck` | phase entered 3+ times | bk-problem-solving | bk-brainstormer | AskUserQuestion |
| `architecture_concern` | "architecture violation" | Suggest brainstormer to user | bk-brainstormer (if approved) | AskUserQuestion |
| `mcp_timeout` | MCP>10s / refused | Auto-fallback (hook-managed) | — | — |

**Limits:** max 2 reactive dispatches per signal. If both fail → MUST AskUserQuestion.
Reactive output path: `bk/dev/shared/reactive/{signal}-{feature}.md`

### MCP Auto-Fallbacks
Serena → Grep/Glob | xcode-mcp/xcode-build → `xcodebuild` CLI | Figma → retry once, then AskUserQuestion

---

## 6. User Interaction

### When MUST Ask User
- Confidence < 70% on any decision
- 2+ agents/sources disagree (cannot auto-resolve)
- Architecture change affecting > 3 files
- 2 reactive escalation attempts both failed
- Committing code / creating new plan (non-trivial) / creating PR/MR

### When NOT to Ask (Auto-Proceed)
- Confidence >= 70% → proceed, log decision
- Single clear approach, reactive dispatch, MCP fallback, fix loop < max, Trivial tier

### AskUserQuestion Format (mandatory 4 elements)
```
**Context:** {1-2 sentences about current situation}
**Issue:** {what needs a decision}
**Options:**
1. {Recommended option} ← Recommended
2. {Alternative}
3. {Conservative — "Cancel" / "Add context"}
**Why I recommend option 1:** {brief rationale}
```

### Confidence Levels
| Level | Threshold | Conductor action |
|-------|-----------|-----------------|
| HIGH | ≥80% | Continue normally |
| MEDIUM | 50–79% | Log warning, continue, monitor |
| LOW | <50% | Trigger reactive protocol (§5) |

---

## 7. Quick Reference — Original Rule Files

| Topic | File |
|-------|------|
| Conductor role, orchestration, skill pipelines | `_base/conductor-role.md` |
| Core rules, project detection, command routing | `_base/core-rules.md` |
| Team coordination, file-based handoffs | `_base/team-rules.md` |
| State machine, FSM transitions | `_base/state-machine.md` |
| Approval rules, risk tiers | `_base/approval-rules.md` |
| Reactive orchestration, signal detection | `_base/reactive-orchestration.md` |
| User interaction, AskUserQuestion format | `_base/user-interaction-protocol.md` |
| Tool restrictions per agent | `_base/agent-protocols/tool-restriction.md` |
| Batch execution (bk-code) | `bk-code/references/batch-execution.md` |
