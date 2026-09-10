# Sub-Task Template: Input Extraction (Sub-Task 00)

Use for: P3 input processing — extracting structured data from Figma/OpenAPI/docs.
Only include this sub-task when user provides input sources.

```markdown
---
sub-task: 00
title: "Extract Inputs"
depends: []
parallel-with: []
status: pending
effort: {Xh}
platform: {ios|android|flutter}
owns: ["{plan-dir}/inputs/**"]
reqs: []
---

# Sub-Task 00: Extract Inputs

Extract structured data from provided sources into `inputs/` directory.

## Sources

| Source | Path/URL | Script |
|--------|----------|--------|
| OpenAPI | `{path to spec file}` | `transform-openapi` |
| Figma | `{URL}` | owned by `/bk-spec` — read its `design/*/design.md` outputs, do not re-extract |
| Docs | `{path to docs directory}` | `combine` (docs-intake) |

_Remove rows for sources not provided._

## Commands

> **Availability precondition.** The `src/scripts/*.ts` helpers below live in the Beer Kit
> **source repository**, not inside an installed kit — `bk-<platform> init` ships only
> `kit/scripts/*.py`. Before running any `npx tsx src/scripts/...` command, check the file
> exists. If it does not, you are in a consumer project: take the inline path instead and do
> not report the missing script as an error.


\```bash
# Create inputs directory
mkdir -p {plan-dir}/inputs

# OpenAPI → ApiOutput
npx tsx src/scripts/cli.ts transform-openapi \
  --input {openapi-spec-path} \
  --output {plan-dir}/inputs/api.json

# Combine → GenerationInput
npx tsx src/scripts/cli.ts combine \
  --platform {platform} \
  --design {plan-dir}/inputs/design.json \
  --api {plan-dir}/inputs/api.json \
  --docs {docs-path} \
  --output {plan-dir}/inputs/generation-input.json
\```

## Tasks

- [ ] Extract OpenAPI spec → `inputs/api.json`
- [ ] Extract Figma design → `inputs/design.json`
- [ ] Extract project docs → `inputs/requirements.json`
- [ ] Combine all → `inputs/generation-input.json`
- [ ] Verify: all output files exist and contain valid JSON

## Expected Output

| File | Key Data |
|------|----------|
| `inputs/api.json` | {N} models, {N} endpoints, baseUrl: {url} |
| `inputs/design.json` | {N} screens: {screen names}, tokens: colors + typography |
| `inputs/requirements.json` | {N} requirements ({N} must, {N} should, {N} could) |
| `inputs/generation-input.json` | Platform: {platform}, combined {size} |

## Success Criteria

- All JSON files parse without errors
- Model count matches OpenAPI spec schemas
- Screen count matches Figma pages/frames
- Requirements extracted with priority levels
```

## Guidelines

- Always sub-task 00 (first sub-task, no dependencies)
- Remove rows/tasks for sources not provided
- Commands section = exact CLI invocations, copy-paste ready
- Expected Output = verify extraction worked correctly
- This sub-task runs before code analysis — code analysis uses these outputs
