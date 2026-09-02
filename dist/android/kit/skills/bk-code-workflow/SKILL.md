---
name: bk-code-workflow
description: "Development workflow patterns for mobile agents — Design-First Gate, output verification, FIX_REQUEST workflow, build commands per platform. Load alongside platform skills."
user-invocable: false
---

# Development Workflow Patterns

> Shared workflow patterns for development agents. Load alongside platform skills (swift, kotlin, flutter).

---

## DESIGN-FIRST GATE (BLOCKING — UI Features)

If task involves Views, Screens, Widgets, or UI components:

1. **Primary path** (canonical — `/bk-spec` output):
   - Glob `bk/dev/{feature}/design/*/design.md` (per-screen specs from `design-spec-writer`)
   - Read `bk/dev/{feature}/.spec-state.json` → check `design_review_verdict`
   - If at least one design.md exists for current task screen:
     - `verdict == "OKAY"` → read screen design.md + `bk/docs/foundation/design-system.md` for tokens, proceed
     - `verdict == "REVISE"` or `design_partial` set → proceed with warning, add `"design_verdict": "REVISE"` to impl-result.json
     - `design_cancelled` → fall through to step 2

2. **Legacy fallback** (backward compat for features built before `/bk-spec` migration — TODO: remove after v2.x sunset, see plan `260511-1447-remove-bk-design-agent-consolidate-to-spec`):
   - Check `bk/dev/shared/design/{feature}-specs.md` and `{feature}-tokens.json`
   - Both exist → read + log warning "DEPRECATED design path — migrate to /bk-spec", proceed

3. **Inline guidance fallback**:
   - Task prompt contains design details (colors, sizes, layout described inline) → proceed, add `"design_specs_missing": true` to impl-result.json

4. **No specs anywhere**:
   - Return error: `"Design specs required. Run /bk-spec --design first to extract Figma specs for this feature."`

Never hardcode colors, fonts, or spacing without design tokens.

### Design Token Validation

After loading design context, validate completeness:

1. **Foundation check:** `bk/docs/foundation/design-system.md` exists (global tokens source of truth)
2. **Per-screen check:** Current task screen's `design.md` has `## Design Tokens` section (or references foundation)
3. **Consistency check:** Color values are valid hex; spacing values are numeric

If validation fails:
- Per-screen design.md missing for current task screen → warn conductor: "Design spec missing for screen {slug}"
- Conductor decides:
  - Proceed with inline guidance + `"design_specs_missing": true`
  - AskUserQuestion: "Quay về /bk-spec --design để extract screen {slug}?"

---

## GATE CHECK: PLAN REQUIRED

Check `bk/dev/feature-*-plan.md` and `bk/dev/research/{feature}-requirements.md` exist before implementation.

---

## UNDERSTANDING CODE BEFORE EDITING

Read the file first. Identify what exists, where to add, and patterns used. Use Grep/Glob for symbol navigation. Grep for similar names to avoid duplication.

---

## RETURNING TO MAIN (needs_info Protocol)

If critical information is missing after checking plan, specs, and design — do not guess. Write partial `impl-result.json` with `"status": "needs_info"`, `"info_needed": ["what's missing"]`, and any `"files_changed"` completed so far.

---

## SPEC READING PROTOCOL

When `spec_index_file` is provided:
1. Read spec-index, find sections mapped to your task IDs
2. Read original spec files at each section's `line_range`
3. Address every `edge_cases[]` item, avoid every `anti_patterns[]` item, follow `samples[]`
4. Report in impl-result.json: `spec_sections_read`, `edge_cases_addressed`, `anti_patterns_avoided`

**STOP GATE**: If spec-index provided AND your task ID appears nowhere → return error, do not code.

---

## OUTPUT GATE: VERIFY BEFORE PROCEEDING (BLOCKING)

After coding, write these files before spawning post-tasks:

1. `impl-result.json` — implementation summary
2. `test-plan.md` — test specifications

### impl-result.json Required Fields

```json
{
  "agent": "string (required)",
  "feature": "string (required)",
  "timestamp": "string (required)",
  "specs_read": "object (required)",
  "requirements_satisfied": "array (required)",
  "files_changed": "array (required, min 1 item)",
  "test_plan": "string (required)",
  "skills_loaded": "array (required)",
  "spec_sections_read": "array (optional, required when spec-index exists)",
  "learnings": "array (optional, [{type, content}])"
}
```

---

## FIX_REQUEST WORKFLOW

### Detection

If prompt contains "FIX TEST FAILURES", "retry #", "retry_count", "debug_artifacts" path, or "suggested_fixes" array → this is a FIX_REQUEST, not normal implementation.

### Workflow

1. **Read debug artifacts**: `{debug_artifacts}/debug-manifest.json` and logs
2. **Analyze failures**: parse failures, map to file locations, cross-reference with suggested_fixes
3. **Apply fixes**: read each file, apply fix, check impact via Grep
4. **Verify locally** using platform build command
5. **Update impl-result.json** with fix_details field

### Platform Build Commands

| Platform | Verify Command |
|----------|---------------|
| iOS | `xcodebuild build -scheme {scheme} -destination 'platform=iOS Simulator,name=iPhone 15'` |
| Android | `./gradlew assembleDebug` |
| Flutter | `flutter analyze && flutter test` |

**Build Retry**: Max 3 retries per build failure. After 3 failures, return status "partial" with error details.

### fix_details Schema

```json
{
  "fix_details": {
    "retry_number": 1,
    "failures_addressed": ["test_name_1"],
    "changes_made": [
      {"file": "path/to/file", "fix": "description", "line": 42}
    ],
    "ready_for_retest": true
  }
}
```

---

## TRACE MARKERS

When requirement IDs are available in plan task `urd_ref` fields or dispatch prompt:

`// @trace REQ-{feature}-{NNN} [Tn] brief description`

- Place immediately before function/class declaration
- One marker per function-level boundary (not every line)
- Skip entirely if no REQ IDs present
- Include `trace_markers_added` (number) in impl-result.json

---

## CONSTRAINTS

| Rule | Enforcement |
|------|-------------|
| Platform skill first | Load swift/kotlin/flutter before coding |
| Design first | UI = must have specs |
| Test plan | Always write before post-tasks |
| Impl result | Always write before post-tasks |
