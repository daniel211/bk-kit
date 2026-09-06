# Input Processing (Phase 0)

Extract structured data from user-provided sources into `inputs/`.

## Detection

| Source | Detect By | Script / Handler |
|--------|-----------|--------|
| Design (via /bk-spec) | Figma signal OR UI signal | Consume `bk/dev/{feature}/design/*/design.md` produced by `/bk-spec`. NO re-extract in /bk-plan. |
| Figma | — | Owned by `/bk-spec`; `/bk-plan` reads its outputs and never extracts |
| Figma (local fallback) | `design-app/` folder or `bk/docs/design/*.md` files | Read design spec .md files directly (last resort) |
| OpenAPI | `--openapi PATH` or *.yaml/*.json with openapi/swagger field | openapi-transformer.ts |
| Docs | `--docs PATH` or *.md files in specified directory | docs-intake.ts |
| PRD/BRD | `bk/docs/product/prds/`, `bk/docs/requirements/`, `bk/docs/brd/` directories | Dispatch Explore agent → requirements.json |
| Test Specs | `bk/docs/deliverables/testing/`, `bk/docs/test-cases/`, `bk/docs/qa/` | Dispatch Explore agent → requirements.json |
| Architecture | `bk/docs/product/architecture/`, `bk/docs/architecture/` | Dispatch Explore agent → requirements.json |
| API Docs | `bk/docs/api/`, `bk/docs/openapi/` | Dispatch Explore agent → requirements.json |
| User Stories | `bk/docs/stories/`, `bk/docs/user-stories/` | Dispatch Explore agent → requirements.json |

## Design Resolution (Consumer Mode)

`/bk-plan` does NOT extract Figma. Design extraction is owned by `/bk-spec` (uses the `figma` MCP with `design-validator` → `design-spec-writer` × N → `design-asset-exporter`).

```
Design Resolution Priority (in /bk-plan Step 4a):
  1. /bk-spec output present (bk/dev/{feature}/.spec-state.json with design_review_verdict)
     → consume bk/dev/{feature}/design/*/design.md, write inputs/design-refs.json
  2. Figma signal OR UI signal detected but no spec-state.json
     → STOP, AskUserQuestion route user back to /bk-spec --design
     → deprecated path; only invoke if user explicitly opts in
  4. Local design-app/ folder fallback
     → last resort for legacy projects
  5. None available
     → log gap in plan.md ## Gaps
```

### Handoff Contract (/bk-spec → /bk-plan)

Producer files (written by `/bk-spec` Phase 2):

| Path | Producer | Consumer use |
|------|----------|--------------|
| `bk/dev/{feature}/.spec-state.json` | Phase 2 state | Read `design_review_verdict`, `design_partial`, `design_cancelled` |
| `bk/dev/{feature}/design/{slug}/design.md` | design-spec-writer | Per-screen specs (read by dev agents) |
| `bk/dev/{feature}/design/raw/component-contracts.json` | design-validator | Component contract reference |
| `bk/dev/{feature}/srs/05-ui-ux-requirements.md` | bk-docs-writer (Phase 2 Step 4) | UI requirements summary |

Consumer file (written by `/bk-plan` Step 4a):

```json
// {plan-dir}/inputs/design-refs.json — pointer file, NOT a copy
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

bk-planner agent prompt MUST include: "Read `inputs/design-refs.json` if exists — use pointer paths to load design context per screen."

## Enterprise Document Dispatch

When enterprise doc directories are detected, dispatch Explore agent to read and summarize:

```
Task(
  subagent_type: "Explore",
  model: "sonnet",
  run_in_background: true,
  description: "Read enterprise docs for {feature}",
  prompt: "
    Scan enterprise documentation directories for feature: {feature}

    Directories found:
    {list detected paths: bk/docs/product/prds/, bk/docs/requirements/, etc.}

    For each document:
    1. Read full content
    2. Extract sections relevant to '{feature}'
    3. Classify: requirement, test spec, architecture constraint, acceptance criterion

    Output — write to: {plan-dir}/inputs/requirements.json
    {
      "source_docs": ["path1.md", "path2.md"],
      "requirements": [{"id": "REQ-001", "type": "functional|nonfunctional",
        "description": "...", "source": "path", "priority": "P0|P1|P2"}],
      "test_specs": [{"id": "TC-001", "description": "...",
        "type": "unit|integration|e2e", "source": "path"}],
      "architecture_constraints": ["..."],
      "acceptance_criteria": ["..."]
    }

    Also write summary: {plan-dir}/research/enterprise-docs-summary.md
  "
)
```

## CLI Execution (Fallback)

> **Availability precondition.** The `src/scripts/*.ts` helpers below live in the Beer Kit
> **source repository**, not inside an installed kit — `bk-<platform> init` ships only
> `kit/scripts/*.py`. Before running any `npx tsx src/scripts/...` command, check the file
> exists. If it does not, you are in a consumer project: take the inline path instead and do
> not report the missing script as an error.

```bash
# Verify availability first — skip this whole section if absent
[ -f src/scripts/cli.ts ] || echo "TS pipeline unavailable — use the inline/MCP path above"
```

Run the scripts via npx tsx from the source repo root:

```bash
# OpenAPI → ApiOutput
npx tsx src/scripts/cli.ts transform-openapi --input {path} --output {plan-dir}/inputs/api.json

# Combine all → GenerationInput
npx tsx src/scripts/cli.ts combine \
  --platform {platform} \
  --design {plan-dir}/inputs/design.json \
  --api {plan-dir}/inputs/api.json \
  --docs {docs-path} \
  --output {plan-dir}/inputs/generation-input.json
```

## Output Files

| File | Type | Content | Used By |
|------|------|---------|---------|
| `inputs/design.json` | DesignOutput | screens[], tokens{} | UI phase templates (Figma Input, Strings) |
| `inputs/api.json` | ApiOutput | models[], endpoints[], baseUrl | Coding phases (Expected Code) |
| `inputs/requirements.json` | ProjectRequirements | requirements[], techStack | plan.md (Requirements), test phase |
| `inputs/generation-input.json` | GenerationInput | Combined, platform-tagged | bk-code agent (full context) |

## Data Flow Into Plan

| P3 Data | → Plan Section |
|---------|----------------|
| `design.screens[]` | phase-ui: `## Input (from Figma)` — components, layout, interactions |
| `design.tokens` | phase-ui: `## Strings` — colors referenced; `## Expected Code` — design token usage |
| `api.models[]` | phase-coding: `## Expected Code` — model structs/classes |
| `api.endpoints[]` | phase-coding: `## Expected Code` — service methods |
| `requirements[]` | plan.md: requirements table; phase YAML: `reqs` field |
| `requirements[].relatedScreens` | Links screens → requirements for traceability |
| `requirements[].relatedEndpoints` | Links endpoints → requirements for traceability |

## Skip Conditions

- No Figma + no OpenAPI + no docs + no enterprise dirs → skip Phase 0 entirely, plan from description only
- Partial inputs: extract what's available, note gaps in plan.md `## Gaps`
- Figma MCP unavailable + no REST token + no design-app/ → skip design, note in gaps
- Enterprise dirs empty or no feature-relevant content found → skip, note in gaps
