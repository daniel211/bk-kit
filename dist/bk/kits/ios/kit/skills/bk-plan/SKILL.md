---
name: bk-plan
description: "Plan mobile features with structured input processing, code impact analysis, and expected code preview per platform."
user-invocable: true
argument-hint: "[feature] [--fast|--deep] [--parallel|--sequential] [--figma URL] [--openapi PATH] [--docs PATH] [--archive PLAN_DIR]"
---

# Plan: $ARGUMENTS

Research, triage, analyze codebase, process inputs, dispatch agents, produce a sub-task-based
plan with expected code for user review.

## Archive Mode

`--archive PLAN_DIR` skips the whole workflow: verify, mark `status: archived`, move to
`bk/dev/archive/{dir-name}/`. No research, no synthesis, no agents.
Load: `references/archive-mode.md`

## Workflow Modes

Default `--auto` (detect from triage + complexity). `--fast` skips research + critic + validate +
gap escalation; `--deep` / `--parallel` / `--sequential` run all of them. Inputs are processed in
every mode when provided. Load: `references/workflow-modes.md`

## CRITICAL ENFORCEMENT

- Step 6 (Research) **MUST** Task(bk-researcher) ×2 — DO NOT research yourself (skip in fast mode)
- Step 6 ≠ Step 4b: 4b = Explore for document EXTRACTION, 6 = bk-researcher for RESEARCH
- Step 8 (Synthesize) **MUST** Task(subagent_type: "bk-planner") foreground — DO NOT write plan.md/sub-task-*.md yourself
- Step 9 (Critic) **MUST** Task(bk-code-reviewer) — DO NOT self-review (skip in fast/trivial)
- If normal mode < 3 Task() calls → INCOMPLETE

**AGENT NAMING:** never the built-in `Plan()` (no serena MCP, no sub-agents, no architecture
skill, no project memory) — always `Task(subagent_type: "bk-planner", model: "opus", ...)`.

| Step | Agent | Model | Execution | Condition |
|------|-------|-------|-----------|----------|
| 4b | Explore | default | background | If enterprise docs found |
| 6 | bk-researcher ×2 | haiku | background | **MUST** (skip fast) |
| 8 | **bk-planner** | **opus** | **foreground** | **MUST** — plan writing (NOT built-in Plan) |
| 9 | bk-code-reviewer | sonnet | background | **MUST** (skip fast/trivial) |

Step 4a dispatches no agent — pointer-only over `/bk-spec` output (STOP+AskUser if missing).
Fast mode floor: bk-planner only = 1 Task().

## Workflow

**0b. AutoDream (optional)** — if `.autodream/{feature}.json` exists or `--autodream` is passed,
seed the plan from it instead of researching those areas.
Load: `references/autodream-integration.md`

1. **Check Foundation** — read all 6 `bk/docs/foundation/` files into `foundation_context`, load
   `platform-context.json`. IF `overview.md` missing → **STOP**: "Foundation docs not found.
   Run `/bk-bootstrap` first to scan project." Load: `references/foundation-check.md`

2. **Parse & Triage** — feature name, flags, input paths from `$ARGUMENTS`; scope →
   small/normal/large/massive; parallel signals if `--parallel`/`--auto`.
   Load: `references/feature-triage.md` + `references/parallel-planning.md`

   **2a. Declare the workflow** — write `bk/dev/shared/.workflow-state.json`:
   `workflow_type`/`command: "bk-plan"`, `feature`, `plan_dir`, `platform`,
   `current_phase: "planning"`. Skip it and the plan runs as whatever workflow ran last.
   Load: `references/workflow-state.md`

   **2b. Task Tracking** — TaskCreate per dispatch step, updated before/after each dispatch.
   Load: `references/task-tracking-setup.md`

3. **Feature SRS** — project SRS extract + brief interview → `bk/dev/{feature}/srs.md`
   Load: `references/feature-srs.md` — Skip if: fast mode or trivial scope

4. **Input Processing** — Extract Figma/OpenAPI/docs/enterprise inputs → `inputs/`
   Load: `references/input-processing.md` — Skip if: no input sources provided

   **4a. Design Specs Handoff** — consumer-only, NO dispatch. `/bk-spec` owns design extraction;
   bk-plan only writes the pointer file `inputs/design-refs.json`. UI/Figma signal but no
   `/bk-spec` run → **STOP + AskUserQuestion**. Load: `references/design-handoff.md`

   **4b. Enterprise Docs** — scan well-known doc dirs; if found, Task(Explore, background) →
   `inputs/requirements.json` + `research/enterprise-docs-summary.md`. IDs verbatim, never
   renumbered. Load: `references/enterprise-docs.md`

5. **Code Analysis** — feature-specific scan + blast radius (no full re-scan): Grep keywords +
   Serena semantics when available. Output: code snippets + impact summary for the plan.
   Load: `references/code-analysis.md` + `references/serena-code-analysis.md` (if Serena MCP)

6. **Research** — MUST dispatch bk-researcher ×2 in ONE message (parallel, background):
   1 = domain (best practices, pitfalls, security), 2 = platform patterns. Never substitute
   Explore (that is Step 4b). Output: `{plan-dir}/research/researcher-*.md`.
   **Timeout 5 min/researcher** — on timeout save partial results and continue.
   Load: `references/agent-dispatch.md` — copy-paste dispatch syntax

7. **Gap Escalation** — aggregate gaps, get user decisions for CRITICAL/HIGH
   Load: `references/gap-escalation.md` — Skip if: fast mode or no CRITICAL/HIGH gaps

8. **Synthesize Plan** — DELEGATE to bk-planner (foreground, opus); never write plan.md or
   sub-task-*.md yourself. Pass foundation, research, inputs, srs, scope, gap decisions.
   Load: `references/agent-dispatch.md` § Planner Dispatch + `references/plan-synthesis.md`

   **8b. Plan Quality Self-Check** — sub-task naming, ≥3 `## Scope` paths, `## Expected Code`,
   `## Tasks` checkboxes, `## Success Criteria`, ≤120 lines. Fix before critic.
   Load: `references/agent-dispatch.md` § Step 8b

9. **Critic Review** — MUST dispatch bk-code-reviewer (background). DO NOT self-review.
   `TaskUpdate(T6)` around the dispatch.
   Load: `references/critic-review.md` + `references/agent-dispatch.md`

10. **Validate** — critical questions interview via `AskUserQuestion`
    Load: `references/validate-interview.md` — Skip if: fast mode

11. **Hydrate Tasks** — checkboxes → TaskCreate with dependency chain (parallel-group tasks carry
    no `addBlockedBy`). Load: `references/task-hydration.md` + `references/handoff-protocol.md`
    — Skip if: < 3 sub-tasks

12. **Present** — write `.plan-state.json`, show the plan summary, ask approve / revise / cancel.
    On approve: `node .claude/cli/bk-health/index.cjs --set-phase completed`, then output `/bk-code {plan-dir}/plan.md`.
    On cancel: `--set-phase aborted`. (Edit of `current_phase` is the fallback.)

## Output Contract

```
bk/dev/{feature}/
├── .plan-state.json                # Workflow state (steps, gap decisions)
├── srs.md                          # Feature SRS (Step 3)
├── plan.md                         # Inputs, code impact, sub-tasks, gaps
├── sub-task-00-extract-inputs.md   # Input extraction (if inputs provided)
├── sub-task-01-*.md                # Implementation sub-tasks + expected code
├── sub-task-XX-tests.md            # Test cases (description only)
├── research/                       # code-analysis-summary.md, researcher-1-domain.md,
│                                   # researcher-2-platform.md, enterprise-docs-summary.md,
│                                   # critic-review.md
└── inputs/                         # generation-input.json, design.json, api.json,
                                    # requirements.json
```

Load: `references/handoff-to-dev.md` for the bk-code contract.
Load: `references/handoff-protocol.md` for state tracking + agent communication.

Every sub-task carries a `reqs:` frontmatter field with the IDs it fulfils, verbatim and never
renumbered (`reqs: []` if no source, `## Scope` says why). Protocol: `rules/traceability.md`.

## Constraints

- DO NOT implement code — plan only
- Expected code in sub-tasks = preview for review, not final
- Always show plan to user before approve
- Sub-task files under 120 lines
- plan.md under 60 lines
- Use localized string keys in UI expected code, never hardcoded text
- Agents write to pre-agreed file paths, not prompt-based output
- Critic review dispatched as separate agent, never self-review

## Reactive Orchestration Reminder

After each agent dispatch returns, check its output for reactive signals. Helper skills
dispatchable at any point: **bk-brainstormer** (stuck on approach / architecture concern),
**bk-docs-seeker** (unknown API or framework error), **bk-sequential-thinking** (complex
decomposition, conflicting data), **bk-problem-solving** (fix loops, breakthrough needed).

**Decision tables:** `rules/reactive-orchestration.md` — **User interaction:** `rules/user-interaction-protocol.md`
