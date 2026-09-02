---
name: bk-plan
description: "Plan mobile features with structured input processing, code impact analysis, and expected code preview per platform."
user-invocable: true
argument-hint: "[feature] [--fast|--deep] [--parallel|--sequential] [--figma URL] [--openapi PATH] [--docs PATH] [--archive PLAN_DIR]"
---

# Plan: $ARGUMENTS

Research, triage, analyze codebase, process inputs, dispatch agents,
produce phase-based plan with expected code for user review.

## Archive Mode

When `--archive PLAN_DIR` is passed, skip normal workflow and:

1. Verify `PLAN_DIR` exists and contains `plan.md`
2. Read `plan.md` frontmatter — confirm all phase statuses are complete (or force with `--force`)
3. Update frontmatter `status: archived` in `plan.md`
4. Move entire plan directory to `bk/dev/archive/{dir-name}/`
5. Report: "Archived {feature} → bk/dev/archive/{dir-name}/"

No research, no synthesis, no agents dispatched.

## Workflow Modes

Default: `--auto` (detect from triage + task complexity).

| Flag | Mode | Research | Inputs | Critic | Validate | Gap Escalation |
|------|------|----------|--------|--------|----------|----------------|
| `--auto` | Auto-detect | Follows mode | If provided | Follows mode | Follows mode | If CRITICAL/HIGH |
| `--fast` | Fast | Skip | If provided | Skip | Skip | Skip |
| `--deep` | Deep | Parallel researchers | If provided | Yes (dispatched) | Yes | Yes |
| `--parallel` | Parallel | Follows deep | If provided | Yes (dispatched) | Yes | Yes |
| `--sequential` | Sequential | Follows deep | If provided | Yes (dispatched) | Yes | Yes |

Load: `references/workflow-modes.md`

## CRITICAL ENFORCEMENT

- Step 6 (Research) **MUST** Task(bk-researcher) ×2 — DO NOT research yourself (skip in fast mode)
- Step 6 is DIFFERENT from Step 4b: Step 4b = Explore for document EXTRACTION, Step 6 = bk-researcher for domain/platform RESEARCH
- Step 8 (Synthesize) **MUST** Task(subagent_type: "bk-planner") foreground — DO NOT write plan.md/sub-task-*.md yourself
- Step 9 (Critic) **MUST** Task(bk-code-reviewer) — DO NOT self-review (skip in fast/trivial)
- If normal mode < 3 Task() calls → INCOMPLETE

**AGENT NAMING WARNING:**
- DO NOT use built-in `Plan()` agent — it has NO serena MCP, NO sub-agent spawning, NO architecture skill, NO project memory
- MUST use: `Task(subagent_type: "bk-planner", model: "opus", ...)` — this dispatches the CUSTOM bk-planner agent from agents/bk-planner.md
- bk-planner capabilities: opus model, serena MCP, Task(Explore), Task(bk-researcher), foreground, skills(bk-architecture, bk-sequential-thinking, bk-docs-seeker), project memory

| Step | Agent | Model | Execution | Condition |
|------|-------|-------|-----------|----------|
| Step 4a | (no agent — consume /bk-spec output) | — | — | Pointer-only; STOP+AskUser if missing |
| Step 4b | Explore | default | background | If enterprise docs found |
| Step 6 | bk-researcher ×2 | haiku | background | **MUST** (skip fast) |
| Step 8 | **bk-planner** | **opus** | **foreground** | **MUST** — plan writing (NOT built-in Plan) |
| Step 9 | bk-code-reviewer | sonnet | background | **MUST** (skip fast/trivial) |

**VALIDATION:** Normal mode < 3 Task() calls → INCOMPLETE. Fast mode: bk-planner only = 1 Task() minimum.

## Workflow

### Step 0b: AutoDream Integration (Optional)

IF AutoDream artifact available (detected: `.autodream/{feature}.json` or user provides `--autodream` flag):
  1. Read AutoDream output: task breakdown, architecture overview, dependency map, risk register
  2. Pre-populate plan structure:
     - Task breakdown → sub-task drafts
     - Architecture overview → architecture validation baseline
     - Dependency map → execution batch ordering
     - Risk register → review focus areas
  3. Skip bk-researcher dispatch for items already covered by AutoDream
  4. bk-planner validates + enriches AutoDream output (not from scratch)
  5. Note in plan.md: "Plan seeded from AutoDream artifact. Validated by bk-planner."

1. **Check Foundation** — verify bootstrap, load project context
   - IF `bk/dev/{feature}/spec-summary.md` exists → read as pre-collected input (skip redundant interview questions for inputs already gathered by bk-spec)
   - Check `bk/docs/foundation/overview.md` exists
   - IF missing → **STOP**. Show: "Foundation docs not found. Run `/bk-bootstrap` first to scan project."
   - IF exists → read ALL 6 foundation files and extract specific data:
     1. `bk/docs/foundation/overview.md` → extract: platform, entry points, module map
     2. `bk/docs/foundation/architecture.md` → extract: architecture pattern, state management, DI, layer map
     3. `bk/docs/foundation/code-guidelines.md` → extract: naming conventions, lint rules, test patterns
     4. `bk/docs/foundation/dependencies.md` → extract: core deps, version constraints
     5. `bk/docs/foundation/build-targets.md` → extract: build commands, CI config
     6. `bk/docs/foundation/design-system.md` (if exists) → extract: UI components, theming
   - Store extracted data as `foundation_context` for use in all subsequent steps:
     ```
     foundation_context = {
       platform, entryPoints, moduleMap,
       architecturePattern, stateManagement, di, layerMap,
       namingConventions, lintRules, testPatterns,
       coreDeps, versionConstraints,
       buildCommands, ciConfig,
       uiComponents, theming
     }
     ```
   - Load `platform-context.json`
   Load: `references/foundation-check.md`

2. **Parse & Triage** — feature name, scope assessment
   - Parse `$ARGUMENTS` for feature name, flags, input paths
   - Platform already known from foundation (Step 1)
   - Triage: evaluate scope signals → small/normal/large/massive
   - Detect parallel signals (see `references/parallel-planning.md`) if `--parallel` or `--auto`
   Load: `references/feature-triage.md`

### Step 2b: Create Task Tracking

Create tasks for agent dispatch steps (progress visibility):

```
# Conditional tasks based on mode and inputs:
IF inputs detected:
  T1 = TaskCreate(subject="Extract enterprise docs",    activeForm="Extracting docs")
  T2 = TaskCreate(subject="Extract design specs",       activeForm="Extracting design")
IF NOT fast mode:
  T3 = TaskCreate(subject="Research domain knowledge",  activeForm="Researching domain")
  T4 = TaskCreate(subject="Research platform patterns", activeForm="Researching platform")

# Core tasks (always):
T5 = TaskCreate(subject="Write implementation plan",    activeForm="Writing plan",     addBlockedBy=[T3?, T4?])
T6 = TaskCreate(subject="Critic review plan",           activeForm="Reviewing plan",   addBlockedBy=[T5])
T7 = TaskCreate(subject="Validate with user",           activeForm="Validating",       addBlockedBy=[T6])
T8 = TaskCreate(subject="Hydrate tasks for bk-code",    activeForm="Hydrating tasks",  addBlockedBy=[T7])
```

Update: `TaskUpdate(taskId, status: "in_progress")` before dispatch, `TaskUpdate(taskId, status: "completed")` after agent returns.

3. **Feature SRS** — extract/generate feature requirements
   - Read `bk/docs/srs/` (project-level, if exists)
   - Extract feature-relevant requirements
   - Brief user interview (2-3 questions)
   - Write `bk/dev/{feature}/srs.md`
   Load: `references/feature-srs.md`
   Skip if: fast mode or trivial scope

4. **Input Processing** — Extract Figma/OpenAPI/docs/enterprise inputs → `inputs/`
   Load: `references/input-processing.md`
   Skip if: no input sources provided

   **4a. Design Specs Handoff (Consumer-only — NO dispatch)**

   Design extraction is owned by `/bk-spec` (uses `design-validator` + `design-spec-writer` + `design-asset-exporter` via `figma-mcp-go` MCP). `/bk-plan` consumes existing outputs — never re-extracts.

   ```
   has_figma_signal = (--figma flag OR Figma URL in description OR frame names in PRD/BRD)
   has_ui_signal    = (bk/dev/{feature}/srs/05-ui-ux-requirements.md exists
                       OR UI keywords in description: screen, view, màn hình, giao diện, UI)

   IF has_figma_signal OR has_ui_signal:
     spec_state = bk/dev/{feature}/.spec-state.json
     design_dir = bk/dev/{feature}/design/

     CASE: spec_state missing
       STOP. AskUserQuestion (Vietnamese):
         "Feature có signal về UI/Figma nhưng chưa chạy /bk-spec. Quay về extract design trước?"
         options:
           - "Quay về /bk-spec --design"  (Recommended) → halt /bk-plan, instruct user run /bk-spec
           - "Tiếp tục không có design"   → log gap in plan.md ## Gaps, skip 4a
     END

     CASE: spec_state exists, read state.design_review_verdict
       IF verdict == "OKAY":
         Glob design_dir + "*/design.md" → screens[]
         Write {plan-dir}/inputs/design-refs.json (pointer file, see schema below)
       ELSE IF verdict == "REVISE" OR state.design_partial set:
         Write design-refs.json with available screens + flag "verdict": "REVISE"
         Note in plan.md ## Gaps: "Design review verdict REVISE — extracted set is partial"
       ELSE IF state.design_cancelled:
         Log gap: "Design extraction was cancelled in /bk-spec — no design context"
         Skip 4a
       ELSE (verdict unknown / phase not reached / spec_state JSON unparseable):
         Treat as spec_state missing → use same AskUserQuestion as CASE above:
           "Spec design phase chưa hoàn tất. Quay về extract design trước?"
           options:
             - "Quay về /bk-spec --design"  (Recommended) → halt /bk-plan
             - "Tiếp tục không có design"   → log gap in plan.md ## Gaps, skip 4a
     END
   ELSE (no Figma signal, no UI signal):
     Skip 4a entirely
   ```

   Note: If `.spec-state.json` exists but is malformed/unparseable → treat as spec_state missing (verdict unknown branch).

   `inputs/design-refs.json` schema (pointer file, NOT a copy):
   ```json
   {
     "source": "bk-spec",
     "feature_slug": "{feature}",
     "design_dir": "bk/dev/{feature}/design",
     "screens": [
       {"slug": "qr-scanner", "design_md": "bk/dev/{feature}/design/qr-scanner/design.md"}
     ],
     "ui_requirements": "bk/dev/{feature}/srs/05-ui-ux-requirements.md",
     "component_contracts": "bk/dev/{feature}/design/raw/component-contracts.json",
     "verdict": "OKAY|REVISE|partial|cancelled"
   }
   ```

   Feed design-refs.json into sub-task templates:
     - UI sub-tasks: `## Design Specs` section references screen design.md paths
     - Strings/tokens: dev agents read per-screen `design.md` + foundation `design-system.md`
     - Expected Code: design tokens consumed at code-gen time, not in plan

   **4b. Enterprise Document Detection & Dispatch**
   Detect enterprise docs in well-known directories:
   ```
   Enterprise doc paths to scan:
     - PRD/BRD:        bk/docs/product/prds/, bk/docs/requirements/, bk/docs/brd/
     - Test specs:     bk/docs/deliverables/testing/, bk/docs/test-cases/, bk/docs/qa/
     - Architecture:   bk/docs/product/architecture/, bk/docs/architecture/
     - API specs:      bk/docs/api/, bk/docs/openapi/
     - User stories:   bk/docs/stories/, bk/docs/user-stories/

   IF any enterprise doc directories found:
     Task(
       subagent_type: "Explore",
       model: "sonnet",
       run_in_background: true,
       description: "Read and summarize enterprise docs for {feature}",
       prompt: "
         Read enterprise documentation relevant to feature: {feature}

         Directories to scan:
         {list of detected enterprise doc paths}

         For each document found:
         1. Read full content
         2. Extract sections relevant to '{feature}'
         3. Identify: requirements (functional + non-functional),
            test specifications, architecture constraints,
            acceptance criteria, dependency notes

         Output — write to: {plan-dir}/inputs/requirements.json
         Format:
         {
           "source_docs": ["path1.md", "path2.md"],
           "requirements": [
             {"id": "REQ-001", "type": "functional|nonfunctional",
              "description": "...", "source": "path", "priority": "P0|P1|P2"}
           ],
           "test_specs": [
             {"id": "TC-001", "description": "...", "type": "unit|integration|e2e",
              "source": "path"}
           ],
           "architecture_constraints": ["..."],
           "acceptance_criteria": ["..."]
         }

         Also write summary to: {plan-dir}/research/enterprise-docs-summary.md
       "
     )

   Feed enterprise data into plan synthesis:
     - requirements.json → sub-task `reqs:` fields for traceability
     - test_specs → sub-task Test Plan sections (pre-populated test cases)
     - architecture_constraints → plan.md ## Constraints + sub-task review checklists
     - acceptance_criteria → sub-task Success Criteria sections
   ```

5. **Code Analysis** — Feature-specific scan, blast radius
   - Broad context from foundation (no full project re-scan)
   - Grep for keyword search + Serena for semantic blast radius (if available)
   - Fallback: Grep/LSP only for feature-relevant files
   Load: `references/code-analysis.md`
   Load: `references/serena-code-analysis.md` (if Serena MCP available)
   Output: existing code snippets + impact summary for plan

6. **Research** — MUST dispatch bk-researcher ×2 parallel (background)

   DO NOT skip this step unless --fast mode.
   DO NOT substitute with Explore agents — Step 4b Explore is for document EXTRACTION, Step 6 is for domain/platform RESEARCH. Different purpose, different agents.

   ```
   TaskUpdate(taskId=T3, status="in_progress")
   TaskUpdate(taskId=T4, status="in_progress")
   ```

   Dispatch 2 researchers in ONE message (parallel background):
   - Researcher 1: Domain knowledge (best practices, pitfalls, security)
   - Researcher 2: Platform patterns (iOS/Android/Flutter specifics)

   Load: `references/agent-dispatch.md` — copy-paste dispatch syntax
   Output: `{plan-dir}/research/researcher-*.md`
   **Timeout: 5 minutes per researcher.** If a researcher exceeds timeout, save partial results and continue with available research data.

   ```
   TaskUpdate(taskId=T3, status="completed")
   TaskUpdate(taskId=T4, status="completed")
   ```

7. **Gap Escalation** — Aggregate gaps, get user decisions for CRITICAL/HIGH
   Load: `references/gap-escalation.md`
   Skip if: fast mode or no CRITICAL/HIGH gaps

8. **Synthesize Plan** — DELEGATE to bk-planner (foreground)

   DO NOT write plan.md and sub-task-*.md files yourself. Dispatch bk-planner.
   bk-planner has: opus model, serena MCP, Task(Explore/bk-researcher), skills(architecture, thinking, docs-seeker).

   ```
   TaskUpdate(taskId=T5, status="in_progress")
   # IMPORTANT: "bk-planner" = custom agent (agents/bk-planner.md)
   # DO NOT use built-in Plan() agent — it lacks serena MCP, sub-agents, architecture skill
   Task(subagent_type: "bk-planner", model: "opus",
     description: "Create implementation plan for {feature}", prompt: "
     Task: Create phased implementation plan
     Feature: {feature_description}
     Platform: {platform}
     Context:
       - bk/docs/foundation/ (project context — architecture, guidelines, deps)
       - {plan-dir}/research/code-analysis-summary.md (Step 5 code impact analysis)
       - {plan-dir}/research/researcher-*.md (Step 6 research outputs)
       - {plan-dir}/inputs/ (design.json, requirements.json if exist)
       - {plan-dir}/srs.md (if exists)
     Scope: {triage_result — small/normal/large/massive from Step 2}
     Gap decisions: {gap_decisions from Step 7 if any}
     Templates: references/plan-synthesis.md, templates/plan-summary.md,
       templates/sub-task-coding.md, sub-task-ui.md, sub-task-test.md
     Output: {plan-dir}/plan.md + {plan-dir}/sub-task-*.md
     Constraints: plan.md < 60 lines, sub-task 30-80 lines each
   ")
   ```

   bk-planner workflow: ORIENT (read Serena memories + foundation) → RESEARCH (Explore/serena) → STRUCTURE → WRITE → SAVE
   Conductor reads plan output → proceeds to Step 8b.
   ```
   TaskUpdate(taskId=T5, status="completed")
   ```

   If parallel mode: include `execution: parallel` instruction + `owns:` glob enforcement in planner prompt.
   Load: `references/parallel-planning.md` if parallel


8b. **Plan Quality Self-Check** — validate plan completeness before critic
    - Every phase has ≥3 concrete file paths in `## Implementation Steps`
    - Every phase has `## Expected Code` section with actual code preview
    - Every phase has `## Success Criteria` with testable conditions
    - No phase exceeds 120 lines
    - plan.md references foundation docs where relevant
    - IF any check fails → fix before proceeding to critic

9. **Critic Review** — MUST dispatch bk-code-reviewer (background)

   DO NOT skip this step unless --fast mode or < 2 sub-tasks.
   DO NOT self-review — dispatch a SEPARATE agent.

   ```
   TaskUpdate(taskId=T6, status="in_progress")
   ```
   Load: `references/critic-review.md` + `references/agent-dispatch.md`
   ```
   TaskUpdate(taskId=T6, status="completed")
   ```

10. **Validate** — Critical questions interview via `AskUserQuestion` tool
    Load: `references/validate-interview.md`
    Skip if: fast mode

11. **Hydrate Tasks** — Checkboxes → TaskCreate with dependency chain
    Load: `references/task-hydration.md`
    State: `references/handoff-protocol.md`
    Skip if: < 3 phases
    If parallel mode: parallel group tasks have no `addBlockedBy` between them; sequential deps use `addBlockedBy` as normal

12. **Present** — Show plan, register context, output bk-code command
    - Write `.plan-state.json` with final state
    - Show plan summary to user
    - Ask: approve / revise / cancel
    - On approve: output `/bk-code {plan-dir}/plan.md`

## Output Contract

```
bk/dev/{feature}/
├── .plan-state.json           # Workflow state (step progress, gap decisions)
├── srs.md                     # Feature SRS (Step 3 output)
├── plan.md                    # Summary: inputs, code impact, phases, gaps
├── phase-00-extract-inputs.md # P3 input extraction (if inputs provided)
├── phase-01-*.md              # Implementation phases with expected code
├── phase-XX-tests.md          # Test cases (description only, no test code)
├── research/                  # Agent outputs (file-based handoffs)
│   ├── code-analysis-summary.md  # Step 3 output
│   ├── researcher-1-domain.md    # Step 6 output
│   ├── researcher-2-platform.md  # Step 6 output
│   ├── enterprise-docs-summary.md # Step 4b output (if enterprise docs found)
│   └── critic-review.md          # Step 7 output
└── inputs/                    # P3 extracted data (phase-00 output)
    ├── generation-input.json  # GenerationInput (combined, for bk-code)
    ├── design.json            # DesignOutput
    ├── api.json               # ApiOutput
    └── requirements.json      # ProjectRequirements
```

Load: `references/handoff-to-dev.md` for bk-code contract.
Load: `references/handoff-protocol.md` for state tracking + agent communication.

### Requirement Tracing
Each sub-task SHOULD include traces in YAML frontmatter:
---
traces: [REQ-payment-001, REQ-payment-003]
---
If SRS exists with REQ IDs, bk-planner maps requirements to sub-tasks.
If no SRS, traces field is omitted.

## Constraints

- DO NOT implement code — plan only
- Expected code in phases = preview for user review, not final
- Always show plan to user before approve
- Phase files under 120 lines
- plan.md under 60 lines
- Use localized string keys in UI expected code, never hardcoded text
- Agents write to pre-agreed file paths, not prompt-based output
- Critic review dispatched as separate agent, never self-review

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
