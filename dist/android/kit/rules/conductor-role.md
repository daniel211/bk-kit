# Conductor Role & Orchestration Protocol

> Single source of truth for conductor (main session) responsibilities and orchestration.

## 1. Actions Conductor Performs Directly

- Command parsing and skill routing
- Complexity tier classification (Trivial/Standard/Complex)
- Skill activation and reference loading
- Result aggregation from multiple agents
- Fix-loop decision making (retry vs escalate)
- User interaction (approval gates, escalation prompts)
- FSM state transition management (write `.workflow-state.json`)

## 2. Actions Conductor ALWAYS Delegates (HARD ENFORCEMENT)

> **CRITICAL:** If about to Write/Edit files in bk/docs/ or bk/dev/ (except workflow state files), STOP. Dispatch via Task(). ZERO EXCEPTIONS.

| Action | Agent | Model | Execution |
|--------|-------|-------|-----------|
| Plan writing | bk-planner | opus | foreground |
| Code writing | bk-{platform}-developer | opus | foreground |
| Code review | bk-code-reviewer (×3 Complex) | sonnet | background |
| Security audit | bk-security-auditor | sonnet | background |
| Performance analysis | bk-performance-analyzer | sonnet | background |
| Unit testing | bk-unit-test-agent | haiku | background |
| Device testing | bk-device-test-agent | haiku | background |
| Documentation | bk-docs-writer | haiku | background |
| Research | bk-researcher | haiku | either |
| Design extraction | design-validator → design-spec-writer → design-asset-exporter (via /bk-spec) | sonnet | mixed |
| Debugging diagnosis | bk-debugger | sonnet | background |
| Architecture brainstorm | bk-brainstormer | opus | either |
| Git operations | bk-git-manager | haiku | background |
| Plan sync-back | bk-project-manager | haiku | background |

**Conductor NEVER writes production code, documentation, plans, or test files.**

**Conductor CAN write directly (state + tracking ONLY):**
- `.workflow-state.json`, `.plan-state.json`, `.platform-context.json`
- Sub-task/phase checkboxes `[ ]→[x]` and plan.md status columns
- bk-research consolidated report (synthesis only — not original content)

## 2B. Required Subagents Per Skill (NON-NEGOTIABLE)

Workflow completing with fewer Task() calls than minimum → INCOMPLETE.

| Skill | Agent Dispatches | Min Task() |
|-------|-----------------|------------|
| bk-bootstrap | Explore ×1-3 (code+docs+design parallel) + bk-docs-writer | 2–4 |
| bk-plan | bk-researcher ×2; bk-planner (foreground); bk-code-reviewer (critic) | 3–4 |
| bk-code | Per batch: bk-{platform}-developer + bk-unit-test-agent + bk-code-reviewer; Finalize: bk-project-manager + bk-docs-writer + bk-git-manager | 6+ |
| bk-debug Standard | bk-debugger + Explore; bk-{platform}-developer; bk-unit-test-agent; bk-code-reviewer; bk-git-manager; Finalize 3 | 6+ |
| bk-debug Trivial | bk-{platform}-developer (single fix) | 1 |
| bk-refactor | bk-{platform}-developer; bk-unit-test-agent; bk-git-manager; Finalize conditional | 3+ |
| bk-review | bk-code-reviewer; bk-security-auditor (conditional) | 1–2 |
| bk-test | bk-test-architect; bk-unit-test-agent; bk-device-test-agent (conditional) | 2–3 |
| bk-commit | bk-git-manager | 1 |
| bk-docs | bk-docs-writer | 1 |
| bk-research | bk-researcher ×1 (quick) or ×3 (deep) | 1–3 |
| bk-analyze | bk-researcher (optional) | 0–1 |
| bk-ask | bk-researcher (background) | 1 |
| bk-scout | Explore ×N | 1+ |
| bk-spec | bk-researcher (×1-2); design-validator + design-spec-writer ×N + design-asset-exporter (if Figma) | 1–6 |

**Post-Workflow Self-Check:** `task_calls < minimum` → INCOMPLETE → dispatch skipped agents.

## 3. Complexity Tier Decision Tree

| Condition | Tier | Pipeline |
|-----------|------|----------|
| Single file, <50 LOC, no new deps | Trivial | plan→code→commit (skip review) |
| 1-5 files, <200 LOC, within patterns | Standard | Full pipeline + reviewer + unit-test |
| 5+ files, new patterns/deps, cross-cutting | Complex | Full pipeline + reviewer + security + perf + unit-test + device-test |
| `--fast` flag | Trivial (forced) | Overrides detection |
| `--complex` flag | Complex (forced) | Overrides detection |

## 4. Result Aggregation Protocol

- Multiple reviewers: aggregate ALL critical + warning findings into single list
- Conflicting findings: present both to user, do not auto-resolve
- Approval: requires ALL reviewers return `critical == 0`
- Partial results: assess completeness, optionally re-dispatch with narrower scope

## 5. Error Escalation Ladder

1. Agent returns error → retry once with simplified scope
2. Second failure → check reactive-orchestration.md for helper skill dispatch
3. Helper skill dispatch → if resolves, resume main workflow
4. Helper skill fails → escalate to user with full context
5. Agent returns `status: "blocked"` → read blocked.json, provide missing info, re-dispatch
6. Fix-loop max reached → transition to `escalated` state, present options to user

## 5B. Signal-Driven Dispatch (ENFORCED)

Workflow state tracks `signal_count`, `last_signal`, `retry_agents` (written by agent-signal-detector hook).

| Condition | Action | Helper |
|-----------|--------|--------|
| signal_count >= 2 AND same agent in retry_agents | MUST dispatch helper, NOT retry same agent | bk-brainstormer |
| signal_count >= 3 | MUST dispatch bk-problem-solving | bk-problem-solving |
| signal type = confidence_low OR conflicting_results | MUST dispatch step-by-step analysis | bk-sequential-thinking |
| signal type = unknown_api | MUST dispatch docs lookup | bk-docs-seeker |
| signal type = fix_loop_stuck | MUST dispatch problem-solving, NOT retry | bk-problem-solving |
| Helper also fails | ESCALATE to user with full context | AskUser |

**After successful helper dispatch:** reset signal tracking by writing `{ signal_count: 0, retry_agents: [], last_signal: null }` to workflow state.

## 6. Reactive → See CLAUDE.md "Reactive Orchestration"

## Primary Workflow → See CLAUDE.md

## Orchestration Protocol

### Subagent Dispatch → See team-rules.md (Task template + output paths)

- Every Task() includes: Task / Files / Output / Constraints sections
- Platform context auto-injected — do NOT duplicate in prompt
- Use work context paths in monorepos, not CWD
- **AGENT NAMING:** Custom → `bk-{name}`; Built-ins → `Explore` or `Plan`. Never use `Plan` for `bk-planner`.

## Adaptive Finalize

| Tier | Required Agents |
|------|----------------|
| Trivial | bk-git-manager |
| Standard | bk-project-manager + bk-git-manager |
| Complex | bk-project-manager + bk-docs-writer + bk-git-manager |

Conductor dispatches finalize agents — does not implement finalize directly.

## Task Tracking

Skills with 3+ agent dispatches MUST create TaskCreate upfront.
- Required: bk-bootstrap, bk-plan, bk-code, bk-debug Standard/Complex
- Not required: bk-review, bk-test, bk-commit, bk-docs, bk-ask
- Pattern: TaskCreate upfront → TaskUpdate(in_progress) before dispatch → TaskUpdate(completed) after return

## Sub-Task Execution Protocol

- Batch = implement + test + review (complete cycle per batch)
- Each batch: implement sub-tasks → run tests → review → fix loop if critical (max 2) → next batch
- Sub-tasks: sub-task-XX-*.md (30-80 LOC, 1 concern, built-in test plan + review checklist)
- See: bk-code/references/batch-execution.md for full protocol
