# Intent Detection

Detect feature + operation from `$ARGUMENTS` and existing spec state. Interview user only when signals are ambiguous.

## Detection Algorithm

```
FUNCTION detectOperation(args, state):
  # Priority 1: Explicit subcommand flag (override all)
  IF args contains "--srs":      RETURN "srs"
  IF args contains "--design":   RETURN "design"
  IF args contains "--api":      RETURN "api"
  IF args contains "--validate": RETURN "validate"

  # Priority 2: Extract input signals
  urd   = extractUrdPath(args)     # .md/.txt, NOT openapi/swagger/api names
  api   = extractApiPath(args)     # .yaml/.json OR .md with api-like name
  figma = extractFigmaUrl(args)    # figma.com URL

  # Priority 3: Resume existing incomplete spec
  feature = resolveFeature(args, state)
  IF feature AND state[feature].current_phase != "complete":
    RETURN resumeOperationFor(state[feature])

  # Priority 4: Multi-input → full workflow
  multi = (urd ? 1 : 0) + (api ? 1 : 0) + (figma ? 1 : 0)
  IF multi >= 2: RETURN "full"

  # Priority 5: Single input
  IF urd:   RETURN "srs"
  IF figma: RETURN "design"
  IF api:   RETURN "api"

  # Default: interview (triggers AskUserQuestion flow)
  RETURN "interview"
```

## Operations

| Operation | Trigger | What runs |
|-----------|---------|-----------|
| `srs` | `--srs` or URD path | Phase 1 (SRS docs) |
| `design` | `--design` or figma.com URL | Phase 2 (Figma extraction) |
| `api` | `--api` or OpenAPI file | Phase 3 (API contract) |
| `validate` | `--validate` or all outputs exist | Phase 4 (verify + summary) |
| `full` | 2+ inputs provided | Phase 1 → 2 → 3 → 4 |
| `resume` | Feature name matches incomplete spec | Continue from `state.current_phase` |
| `interview` | Ambiguous / no feature / no inputs | AskUserQuestion fallback |

## Detection Phases

Detection runs in phases, each corresponding to a step in the algorithm.

### Parse Arguments

Multi-token classification (not just first word):

| Token pattern | Classification |
|---------------|---------------|
| `--srs`, `--design`, `--api`, `--validate` | subcommand |
| `--other-flag` | flag |
| `https://(www.)?figma.com/*` | figma_url |
| Ends `.md`/`.txt` or starts `./`/`/` | urd_path (or api_path if name contains `openapi`/`swagger`/`api`) |
| Ends `.yaml`/`.yml`/`.json` (api-like name) | api_path |
| Remaining tokens | feature_name (join with spaces → slugify) |

### Scan State

Discover ALL spec directories and classify their states.

**Primary** — scan state files:
```
Glob("mk/dev/*/.spec-state.json")
  → read each
  → classify by current_phase (collect, srs, design, validate, complete)
  → sort: incomplete first (current_phase != "complete"), then by updated_at desc
```

**Fallback** — for dirs without `.spec-state.json` (legacy):
```
Glob("mk/dev/*/") → filter out shared/, research/
```

Infer state from file existence:

| Inferred state | Detection rule |
|----------------|---------------|
| plan-dir | `plan.md` OR `sub-task-*.md` exists → skip (not a spec dir) |
| complete | `spec-summary.md` AND `srs/01-overview.md` both exist |
| design-only | `spec-summary.md` AND no `srs/` AND `design/*/design.md` exists |
| srs-done | `srs/` has 5+ .md files, no `spec-summary.md` |
| srs-partial | `srs/` exists with < 5 .md files |
| design-partial | `design/*/design.md` in some subdirs, no spec-summary, no srs |
| empty | none of above |

Result: `allSpecs[]` — all spec dirs with their states, sorted by relevance (incomplete first, then recent).

### Feature Resolution

Priority order:
1. Feature name from args → slugify → check if existing dir matches
2. Subcommand given + single matching spec → auto-resolve
3. No feature name from args → defer to Interview

### State Merge

If feature resolved AND `.spec-state.json` exists:
- Read state → merge with args (args override saved inputs, saved fills gaps)
- Result: `merged = { feature_name, feature_slug, urd_path, api_path, figma_url, operation, current_phase }`

If feature resolved but no `.spec-state.json`:
- Try reconstruct from `spec-summary.md` Input Sources table (parse `| URD | {path} |` rows)
- Set whatever can be extracted

No feature resolved → Interview handles it.

### Interview (Fallback)

Triggered when detection returns `interview` OR signals ambiguous.

Determine what's missing:
- Required: `feature_name` (→ `feature_slug`)
- Optional: `urd_path`, `api_path`, `figma_url`
- Operation: from subcommand arg, or inferred from state

**Infer operation** — if subcommand provided via args → use it directly. Otherwise:

| State (from .spec-state.json) | Suggested operation |
|-------------------------------|-------------------|
| (new feature, no state) | full |
| collect | srs (continue) |
| srs | design (if figma_url) or validate |
| design | validate |
| complete | validate (re-check) or "proceed to /bk-plan" |

For legacy dirs (no `.spec-state.json`):

| Inferred state | Suggested operation |
|----------------|-------------------|
| empty | full |
| srs-partial | srs (resume) |
| srs-done | design (if figma) or validate |
| design-partial | design (resume) |
| design-only | srs (add SRS) or validate |
| complete | validate (re-check) or "/bk-plan" |

**Feature first, operation second.** AskUserQuestion always asks about FEATURE before OPERATION.

**Case 1: Zero questions** — feature + operation resolved from args + .spec-state.json.
Skip AskUserQuestion. Log: `"Proceeding: {operation} for {slug} (phase: {current_phase})"`.

> **PHASE CHECKPOINT** — Feature selection
>
> Trigger: feature name not resolvable from args + state. STOP and ask user via AskUserQuestion.

**Case 2: Feature unknown** — AskUserQuestion about FEATURE (1 question):
- header: `"Feature"`
- question: `"Chọn feature để làm việc, hoặc nhập tên mới."`
- options: up to 3 specs from `allSpecs[]` (incomplete first, then recent complete)
  - label: `"{slug}"`, description: `"{state} — {detail}"`
  - e.g., `"phat-hanh-moi-the-vat-ly"` — `"complete — SRS ✓ Design ✓"`
- If no specs exist: question text guides user to type name via "Other"
- After selection → resolve feature → load state → infer operation:
  - If operation unambiguous → proceed (becomes Case 1)
  - If operation ambiguous → ask (becomes Case 3)

> **PHASE CHECKPOINT** — Operation selection
>
> Trigger: feature resolved but operation cannot be inferred from state. STOP and ask user.

**Case 3: Feature known, operation unknown** — AskUserQuestion about OPERATION (1 question):
- header: `"Operation"`
- question: `"{slug} ({state}). Bạn muốn làm gì?"`
- options: contextual based on state (see operation inference tables above)

### Source Quality Gate

Evaluate source quality from resolved inputs:

```
has_urd   = inputs.urd_path != null AND file exists AND non-empty
has_api   = inputs.api_path != null
has_figma = inputs.figma_url != null

if has_urd:                 source_quality = "verified"
elif has_api AND has_figma: source_quality = "medium"
elif has_api OR has_figma:  source_quality = "low"
else:                       source_quality = "none"
```

**Decision branch:**

| source_quality | Action |
|---------------|--------|
| `verified` | Proceed silently. Log: `"Source quality: verified (URD provided)"` |
| `medium` | Log warning: `"Source quality: medium (no URD — requirements will be inferred)"`. Set `degraded_mode = false`. Proceed. |
| `low` | **AskUserQuestion** (Input Confirmation Gate) |
| `none` | **AskUserQuestion** (No Inputs — must provide at least one) |

> **PHASE CHECKPOINT** — Input degraded confirmation
>
> Trigger: source_quality = `low` (no URD, only API or Figma). STOP and ask user to provide URD or accept degraded mode.

**AskUserQuestion for `low`:**

```
header: "Input"
question: "{feature_name}: Không có tài liệu yêu cầu (URD). SRS sẽ sinh ở chế độ DEGRADED —
  business rules và acceptance criteria suy luận từ {available_source}. Kết quả có thể không chính xác."
options:
  - "Cung cấp URD" — user nhập path ở message tiếp theo → re-evaluate source_quality
  - "Tiếp tục không URD (degraded)" — set degraded_mode = true, proceed
  - "Huỷ" — abort workflow
```

> **PHASE CHECKPOINT** — Required input
>
> Trigger: source_quality = `none` (no URD, API, or Figma). STOP — at least 1 input required to proceed.

**AskUserQuestion for `none`:**

```
header: "Input"
question: "{feature_name}: Không có input nào (URD, API, Figma). Cần ít nhất 1 nguồn để tiếp tục."
options:
  - "Cung cấp URD" — user nhập path ở message tiếp theo
  - "Cung cấp Figma URL" — user nhập URL ở message tiếp theo
  - "Huỷ" — abort workflow
```

**After user provides path/URL:** Re-parse input → update `inputs` → re-evaluate `source_quality`. May skip to `verified` if URD provided.

**Resume logic:** If `.spec-state.json` already has `source_quality` and `degraded_mode`, skip gate (user already answered).

### Persist

1. Slugify feature name: lowercase, spaces/special chars → hyphens, remove accents
2. Create dir: `mk/dev/{slug}/` (and `srs/` if srs operation)
3. Write `.spec-state.json`:

```json
{
  "command": "bk-spec",
  "feature_name": "Feature Name",
  "feature_slug": "feature-name",
  "operation": "full|srs|design|api|validate|resume|interview",
  "current_phase": "collect",
  "phase_history": [
    {"from": "init", "to": "collect", "timestamp": "ISO-8601"}
  ],
  "inputs": {
    "urd_path": "path/to/urd.md or null",
    "api_path": "path/to/api.yaml or null",
    "figma_url": "https://figma.com/... or null"
  },
  "source_quality": "verified|medium|low|none",
  "degraded_mode": false,
  "created_at": "ISO-8601",
  "updated_at": "ISO-8601"
}
```

Backward compat: if `source_quality` missing in existing state → default `"verified"`, `degraded_mode` → `false`.

4. If urd_path provided → read file, validate non-empty and has actual requirements
5. Transition: update `current_phase` to next phase based on operation

## Conflict Resolution

Priority order when multiple signals detected:
1. Explicit subcommand flag (`--srs`, `--design`, `--api`, `--validate`) — always wins
2. Existing incomplete state (resume takes precedence over new inputs)
3. Multi-input detection (2+ inputs → `full`)
4. Single input pattern (urd → srs, figma → design, api → api)
5. Default: `interview`

## Examples

```
/bk-spec payment_feature docs/payment.md
→ operation: srs (URD detected)

/bk-spec payment_feature --design https://figma.com/...
→ operation: design (explicit flag + figma URL)

/bk-spec payment_feature docs/payment.md https://figma.com/... api/payments.yaml
→ operation: full (3 inputs)

/bk-spec payment_feature
  (where .spec-state.json has current_phase: "design")
→ operation: resume (continue design phase)

/bk-spec
→ operation: interview (no args → AskUserQuestion for feature selection)

/bk-spec --validate payment_feature
→ operation: validate (explicit flag wins even if other inputs present)
```
