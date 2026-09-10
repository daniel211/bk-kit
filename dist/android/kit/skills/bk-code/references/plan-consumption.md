# Plan Consumption (Steps 1-2)

Parse bk-plan output, resume from crash, hydrate Claude Tasks.

## Step 1: Parse & Resume

### Parse Input

```
$ARGUMENTS patterns:
- "bk/dev/feature/plan.md"     → full plan execution
- "bk/dev/feature/sub-task-02-*.md" → single sub-task execution
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

1. Read `completedSteps` → skip these sub-tasks
2. Find `currentStep` → resume here
3. Check research/ for incomplete agent outputs:
   - File exists → agent finished, collect result
   - File missing → re-dispatch agent

If no `.plan-state.json` → fresh start from sub-task 00.

### Platform Detection

Read `platforms` from plan.md YAML, then load `platform-context.json` — an installed kit
ships exactly one, already specialised for the platform it was built for.
- Single platform → its `platform-context.json` describes the build, lint and test commands
- Multi-platform → process each platform per sub-task YAML `platform` field, using the
  context of whichever kit is installed in that platform's project

## Step 2: Hydrate Tasks

### Pre-check

1. `TaskList` → if tasks exist for this plan (check metadata.planDir), skip hydration
2. If < 3 sub-task files → skip hydration (3-sub-task rule)

### Hydration Process

For each `sub-task-NN-*.md` sorted by sub-task number:

1. Read YAML `depends` field
2. Read the `## Tasks` section ONLY — each `- [ ]` line = 1 task
   Never hydrate checkboxes from `## Edge Cases & Risks`, `## Success Criteria` or
   `## Review Checklist`; `## Tasks` is the single hydration source
   (see `bk-plan/templates/sub-task-*.md`).
3. Skip already-checked `- [x]` lines
4. No `## Tasks` section → this is a pre-0.6.0 plan. Take the legacy path below instead of
   failing; do NOT fall back to checkboxes in other sections.

### Legacy plans (pre-0.6.0) — sunset at 0.8.0

Sub-task files written before 0.6.0 have no `## Tasks` section, because the templates of the
day had none. Their checkboxes live under `## Success Criteria` and `## Review Checklist`,
and their worklist — where one exists — is plain bullets under a prose heading that may be
localized (`## Việc cần làm`). Hydrating those checkboxes is what the `## Tasks` rule exists
to prevent: it turns acceptance criteria and reviewer questions into work items.

So a legacy sub-task degrades to **coarser tracking, never wrong tracking**:

| | Current plan | Legacy plan |
|---|---|---|
| Tasks created | One per `- [ ]` under `## Tasks` | **One per sub-task file** |
| Task subject | The checkbox text | The sub-task's H1 title (or frontmatter `title`) |
| Completion | Tick the checkbox + TaskUpdate | TaskUpdate + frontmatter `status: complete` |
| Checkboxes elsewhere | Left alone | Left alone — never ticked, never counted |

Also accept these legacy frontmatter spellings when reading (never when writing):

| Legacy | Current | Notes |
|--------|---------|-------|
| `id: sub-task-01` | `sub-task: "01"` | Take the numeric part |
| `traces: [...]` | `reqs: [...]` | Same meaning; see `rules/traceability.md` |
| `files_write:` / `files_read:` | `owns:` | `files_write` is the ownership scope |
| `batch: B1` | plan.md `## Execution Batches` | Group by this when plan.md has no batch table |

Warn once per plan directory, not once per file:

```
⚠ Pre-0.6.0 plan at {plan-dir}: {N} sub-task(s) have no ## Tasks section.
  Tracking one task per sub-task instead of per step. Re-run /bk-plan for step-level
  tracking. This compatibility path is removed in 0.8.0.
```

Do not rewrite a legacy plan in place to the new shape. Silently reshaping a plan the user
is midway through is worse than tracking it coarsely — if they want the new shape, `/bk-plan`
is the way to get it, on their say-so.

```
TaskCreate(
  subject: "{checkbox text}",
  activeForm: "{-ing form}",
  description: "Sub-task {NN}: {title}. File: {sub-task-file-path}",
  metadata: { subTask: NN, planDir: "{plan-dir}", subTaskFile: "{filename}" }
)
```

### Dependency Chain

```
sub-task-01 (depends: [])      → Task A, B (no blockers)
sub-task-02 (depends: [01])    → Task C (addBlockedBy: [A])
sub-task-03 (depends: [01,02]) → Task D (addBlockedBy: [A, C])
```

Block on first task of each dependency sub-task only.

### State Write

After hydration, write/update `.plan-state.json`:
```json
{ "currentStep": 1, "completedSteps": [], "hydration": { "taskCount": N, "subTaskCount": M } }
```
