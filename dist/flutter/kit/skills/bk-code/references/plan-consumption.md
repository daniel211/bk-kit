# Plan Consumption (Steps 1-2)

Parse bk-plan output, resume from crash, hydrate Claude Tasks.

## Step 1: Parse & Resume

### Parse Input

```
$ARGUMENTS patterns:
- "bk/dev/feature/plan.md"     → full plan execution
- "bk/dev/feature/phase-02-*.md" → single phase execution
- "bk/dev/feature/"            → detect plan.md in directory
```

1. Resolve plan directory from argument
2. Read `plan.md` YAML frontmatter: `platforms`, `status`, `created`
3. If status = `completed` → warn user, ask to re-run or abort

### Resume from .plan-state.json

If `{plan-dir}/.plan-state.json` exists:

```json
{
  "feature": "...",
  "currentStep": 3,
  "completedSteps": [1, 2],
  "stepResults": { "1": { "status": "complete" }, ... },
  "platforms": ["ios"],
  "updatedAt": "..."
}
```

1. Read `completedSteps` → skip these phases
2. Find `currentStep` → resume here
3. Check research/ for incomplete agent outputs:
   - File exists → agent finished, collect result
   - File missing → re-dispatch agent

If no `.plan-state.json` → fresh start from phase 1.

### Platform Detection

Read `platforms` from plan.md YAML, then load `platform-context.json` — an installed kit
ships exactly one, already specialised for the platform it was built for.
- Single platform → its `platform-context.json` describes the build, lint and test commands
- Multi-platform → process each platform per phase YAML `platforms` field, using the
  context of whichever kit is installed in that platform's project

## Step 2: Hydrate Tasks

### Pre-check

1. `TaskList` → if tasks exist for this plan (check metadata.planDir), skip hydration
2. If < 3 phase files → skip hydration (3-phase rule)

### Hydration Process

For each `phase-XX-*.md` sorted by phase number:

1. Read YAML `depends` field
2. Read `## Tasks` section — each `- [ ]` line = 1 task
3. Skip already-checked `- [x]` lines

```
TaskCreate(
  subject: "{checkbox text}",
  activeForm: "{-ing form}",
  description: "Phase {N}: {title}. File: {phase-file-path}",
  metadata: { phase: N, planDir: "{plan-dir}", phaseFile: "{filename}" }
)
```

### Dependency Chain

```
Phase 1 (depends: [])    → Task A, B (no blockers)
Phase 2 (depends: [1])   → Task C (addBlockedBy: [A])
Phase 3 (depends: [1,2]) → Task D (addBlockedBy: [A, C])
```

Block on first task of each dependency phase only.

### State Write

After hydration, write/update `.plan-state.json`:
```json
{ "currentStep": 1, "completedSteps": [], "hydration": { "taskCount": N, "phaseCount": M } }
```
