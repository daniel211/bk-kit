# Handoff Protocol

File-based handoffs between agents, state tracking, and resume support.

## Principle

Agents communicate through **files**, not prompt text.
- Replayable: agent fails → re-dispatch with same handoff
- Debuggable: inspect intermediate files to understand what went wrong
- Auditable: full trail of what each agent received and produced

## Plan Directory as Shared State

```
{plan-dir}/
├── .plan-state.json        # Workflow state (current step, completed steps)
├── research/               # Agent outputs (all intermediate results)
│   ├── code-analysis-summary.md  # Step 3: patterns, affected files, blast radius
│   ├── researcher-1-domain.md    # Step 4: domain research
│   ├── researcher-2-platform.md  # Step 4: platform research
│   └── critic-review.md          # Step 7: scoring + verdict
├── inputs/                 # P3 extraction outputs
├── plan.md                 # Final plan
└── phase-*.md              # Phase files
```

All agents read from and write to `{plan-dir}/`. No data passes only through prompts.

## State Tracking

### .plan-state.json

Written after each workflow step completes. Enables resume after crash.

```json
{
  "feature": "user-authentication",
  "mode": "deep",
  "platforms": ["ios", "android"],
  "currentStep": 5,
  "completedSteps": [1, 2, 3, 4],
  "stepResults": {
    "1": { "status": "complete", "triage": "normal" },
    "2": { "status": "complete", "inputsFound": ["api", "design"] },
    "3": { "status": "complete", "filesAffected": 12, "blastRadius": 5 },
    "4": { "status": "complete", "researchFiles": ["researcher-1-domain.md", "researcher-2-platform.md"] }
  },
  "gapDecisions": [],
  "updatedAt": "2026-03-13T10:30:00Z"
}
```

### Update Protocol

After each step:
1. Update `currentStep` to next step number
2. Add completed step to `completedSteps`
3. Record step result summary in `stepResults`
4. Write `.plan-state.json`

### Resume Protocol

On session start, if `{plan-dir}/.plan-state.json` exists:
1. Read state file
2. Find `currentStep` — this is where we left off
3. Check `completedSteps` — skip already-done steps
4. Resume from `currentStep` with context from `stepResults`
5. If mid-agent (researcher dispatched but not collected): check if output files exist
   - Exist → agent finished, proceed to collection
   - Missing → re-dispatch agent

## Agent Handoff Pattern

### Dispatch

1. Write context to `{plan-dir}/research/` or `{plan-dir}/inputs/`
2. Include output path in agent prompt: "write to: {exact-path}"
3. Dispatch agent via Task tool

### Collect

1. Wait for agent completion
2. Read output from pre-agreed path
3. Validate output exists and is non-empty
4. If missing/empty: log warning, retry once, then note gap

### Cross-Agent Data Flow

```
Input Processing (Step 2)
  writes → inputs/api.json, inputs/design.json

Code Analysis (Step 3)
  reads  → inputs/ (if available)
  writes → research/code-analysis-summary.md (patterns, affected files, blast radius)

Researcher (Step 4)
  reads  → research/code-analysis-summary.md, inputs/ (if available)
  writes → research/researcher-1-domain.md, research/researcher-2-platform.md

Gap Escalation (Step 5)
  reads  → research/*.md, code-analysis results
  writes → gaps aggregated in memory, user decisions recorded

Synthesis (Step 6)
  reads  → inputs/, research/, code-analysis, gap decisions
  writes → plan.md, phase-*.md

Critic (Step 7)
  reads  → plan.md, phase-*.md, inputs/
  writes → research/critic-review.md
```

## File Ownership per Phase

Each phase file declares which source files it owns (for parallel execution safety):

```yaml
# In phase YAML frontmatter
owns:
  - "Models/Auth/*.swift"
  - "models/auth/*.kt"
```

Rules:
- `owns` applies to **write access only** — any phase may read any file
- No two phases may own overlapping file patterns for writes
- Shared files (AppRouter, DI container) owned by the phase that modifies them
- If conflict: planner resolves by assigning shared file to one phase only
- bk-code checks ownership before editing — warns if touching unowned files
