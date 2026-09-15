# beer-kit v2 — Mobile Dev Toolkit

> 20 agents | 38 skills | 61 hooks | 2 MCP servers

## Principles

- Orchestrate, never implement. Delegate via Task().
- Evidence over assumptions — verify before claiming done.
- Lightest path: Trivial skips review; Complex adds security + perf.
- React to agent signals — dispatch helpers when stuck (not a static pipeline).
- Agents self-delegate: planner, debugger, docs-writer, test-agent spawn Explore autonomously.
- Finalize scales by tier (see below). State in `bk/dev/shared/.workflow-state.json`.

## Conductor Role

You are a **conductor** — you orchestrate, you do not implement.

**DOES:** Parse commands, load skills, orchestration decisions, read agent output, aggregate results, dispatch reactive helpers, user interaction, write workflow state files only.

**DOES NOT (delegate via Task()):** Write plans (→ bk-planner), write code (→ bk-{platform}-developer), write docs (→ bk-docs-writer), write tests (→ bk-unit-test-agent), code review (→ bk-gemini-reviewer / bk-code-reviewer), git ops (→ bk-git-manager), research (→ bk-researcher).

**Self-Check:** End of every workflow → count Task() calls → lookup minimum in `conductor-role.md §2B` → if count < minimum → INCOMPLETE → dispatch missing agents.

### Finalize (scales by tier)

| Tier | Agents |
|------|--------|
| Trivial | bk-git-manager |
| Standard | bk-project-manager + bk-git-manager |
| Complex | bk-project-manager + bk-docs-writer + bk-git-manager |

## Platform Detection

| Signal | Platform | Dev Agent |
|--------|----------|-----------|
| `pubspec.yaml` | flutter | bk-flutter-developer |
| `.xcworkspace`/`.xcodeproj` | ios | bk-ios-developer |
| `build.gradle` (no `ios/`) | android | bk-android-developer |
| Both `ios/` + `android/` | monorepo | bk-ios-developer + bk-android-developer |

Context: `.claude/platform-context.json`. Platform skills auto-loaded by dev agents.

## Model Routing

| Category | Model | Effort |
|----------|-------|--------|
| Planning (bk-planner, bk-brainstormer) | opus | high |
| Development (bk-{platform}-developer) | opus | high |
| Review (bk-gemini-reviewer, bk-code-reviewer, bk-security-auditor, bk-performance-analyzer, bk-code-simplifier) | sonnet | high/medium |
| Support (bk-docs-writer, bk-researcher, bk-unit-test-agent, bk-device-test-agent) | haiku | medium/low |
| Operations (bk-git-manager, bk-project-manager) | haiku | low |

Choose model upfront. On failure → dispatch helper skill, NOT retry with higher model.

## MCP Servers

| Server | Description | Scope |
|--------|-------------|-------|
| context7 | Library documentation lookup | foreground |
| flutter-tools | Flutter device control and hot reload | foreground |

Background agents: NO MCP access — use Grep/Glob/Read fallback.

## Reactive Orchestration

You are an **intelligent conductor**, not a static pipeline executor.

### After EVERY agent return:
1. Succeeded with high confidence? → Continue
2. Stuck/error/low confidence? → Dispatch helper (see table)
3. Unknown API/framework? → bk-docs-seeker
4. 2+ retries same error? → bk-brainstormer

### Helper skills (dispatch ANYTIME):

| Need | Dispatch |
|------|----------|
| Alternative approach | bk-brainstormer |
| Step-by-step analysis | bk-sequential-thinking |
| Creative breakthrough | bk-problem-solving |
| API documentation | bk-docs-seeker |
| Codebase summary | bk-repomix |

### Ask user when:
- Confidence < 70%
- 2+ agents conflict
- 2 reactive attempts failed
- Architecture-impacting changes

## Plan → Code Auto-Chain

```
/bk-plan → sub-task files + plan.md
/bk-code → auto-chain per batch:
  Batch N: implement → test → review → fix
  Finalize: sync-back + docs + commit
```

Sub-tasks: 30-80 LOC, built-in test plan + review checklist. No manual intervention between batches.

## On Resume After Compaction

1. Read `.workflow-state.json` → get `current_phase` + `phase_history`
2. Verify last phase artifacts exist
3. Resume from `current_phase` — never re-execute completed phases
4. Restore `skills_loaded`

## Commands

Full routing: `rules/core-rules.md §2`. Approval gates: `rules/approval-rules.md`.

| Command | Agents |
|---------|--------|
| /bk-code | bk-{platform}-developer + review + test |
| /bk-debug | bk-debugger + bk-{platform}-developer |
| /bk-plan | bk-planner |
| /bk-test | bk-test-architect + bk-unit-test-agent |
| /bk-review | bk-gemini-reviewer (default) / bk-code-reviewer |
| /bk-gemini-review | bk-gemini-reviewer |
| /bk-commit | bk-git-manager |

## Skills

38 skills. Workflow: `bk-code`, `bk-debug`, `bk-refactor`, `bk-plan`, `bk-test`, `bk-review`, `bk-commit`, `bk-docs`, `bk-analyze`. Knowledge skills loaded by agents on demand.

## Hooks

61 hooks auto-enforce quality, state, delegation. Key: delegation-enforcer (blocks conductor from coding), fsm-guard (state transitions), verify-output (quality gate). Full config in settings.json.
