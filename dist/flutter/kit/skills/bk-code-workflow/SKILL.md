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
     - `verdict == "REVISE"` or `design_partial` set → proceed with warning, add `design_verdict: REVISE` to the impl report frontmatter
     - `design_cancelled` → fall through to step 2

2. **Legacy fallback** (backward compat for features built before `/bk-spec` migration — TODO: remove after v2.x sunset, see plan `260511-1447-remove-bk-design-agent-consolidate-to-spec`):
   - Check `bk/dev/shared/design/{feature}-specs.md` and `{feature}-tokens.json`
   - Both exist → read + log warning "DEPRECATED design path — migrate to /bk-spec", proceed

3. **Inline guidance fallback**:
   - Task prompt contains design details (colors, sizes, layout described inline) → proceed, add `design_specs_missing: true` to the impl report frontmatter

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
  - Proceed with inline guidance + `design_specs_missing: true` in the impl report
  - AskUserQuestion: "Quay về /bk-spec --design để extract screen {slug}?"

---

## GATE CHECK: PLAN REQUIRED

Check `bk/dev/feature-*-plan.md` and `bk/dev/research/{feature}-requirements.md` exist before implementation.

---

## UNDERSTANDING CODE BEFORE EDITING

Read the file first. Identify what exists, where to add, and patterns used. Use Grep/Glob for symbol navigation. Grep for similar names to avoid duplication.

---

## RETURNING TO MAIN (needs_info Protocol)

If critical information is missing after checking plan, specs, and design — do not guess. Write the impl report anyway with `status: needs_info`, `info_needed: ["what's missing"]`, and whatever `files_changed` got done. A missing report is indistinguishable from a crashed agent; a `needs_info` report is actionable.

---

## SPEC READING PROTOCOL

When `spec_index_file` is provided:
1. Read spec-index, find sections mapped to your task IDs
2. Read original spec files at each section's `line_range`
3. Address every `edge_cases[]` item, avoid every `anti_patterns[]` item, follow `samples[]`
4. Report in the impl report: `spec_sections_read` (frontmatter), `## Edge Cases Addressed`, `## Anti-Patterns Avoided`

**STOP GATE**: If spec-index provided AND your task ID appears nowhere → return error, do not code.

---

## OUTPUT GATE: VERIFY BEFORE PROCEEDING (BLOCKING)

After coding, write these files before spawning post-tasks:

1. **The impl report** — one markdown file per dispatch. There is no `impl-result.json`.
2. `test-plan.md` — test specifications

### Impl Report

Write it to the path the dispatch prompt names. If none was given:

| Command | Path |
|---------|------|
| `/bk-code` | `{plan-dir}/research/impl-sub-task-{NN}.md` |
| `/bk-debug` | `bk/dev/shared/reports/impl-{feature}-debug.md` |
| `/bk-refactor` | `bk/dev/shared/reports/impl-{feature}-refactor.md` |

One report per dispatch — never append to another agent's file.

Required frontmatter: `schema_version`, `schema_type: impl-report`, `agent`, `feature`,
`status`, `timestamp`, `build_verified`, `requirements_satisfied`, `files_changed` (min 1
item, each `{path, change, description}`), `skills_loaded`.
Optional: `sub_task`, `spec_sections_read` (required when a spec-index exists), `learnings`,
`info_needed` (required when `status: needs_info`), `design_verdict`, `design_specs_missing`,
`trace_markers_added`, `fix_details`.

Required body sections: `## Summary`, `## Deviations from Expected Code`,
`## Edge Cases Addressed`, `## Anti-Patterns Avoided`, `## Notes for Reviewer`.

Full schema + example: `bk-agent-contract` §3.

`build_verified: true` means the platform build command ran and passed. Never set it from
inspection — downstream agents skip their own build check when they see it.

---

## FIX_REQUEST WORKFLOW

### Detection

If prompt contains "FIX TEST FAILURES", "retry #", "retry_count", "debug_artifacts" path, or "suggested_fixes" array → this is a FIX_REQUEST, not normal implementation.

### Workflow

1. **Read debug artifacts**: `{debug_artifacts}/debug-manifest.json` and logs
2. **Analyze failures**: parse failures, map to file locations, cross-reference with suggested_fixes
3. **Apply fixes**: read each file, apply fix, check impact via Grep
4. **Verify locally** using platform build command
5. **Update the impl report** — add the `fix_details` frontmatter field and note the fix in `## Summary`

### Platform Build Commands

| Platform | Verify Command |
|----------|---------------|
| iOS | `xcodebuild build -scheme {scheme} -destination 'platform=iOS Simulator,name=iPhone 15'` |
| Android | `./gradlew assembleDebug` |
| Flutter | `flutter analyze && flutter test` |

**Build Retry**: Max 3 retries per build failure. After 3 failures, return status "partial" with error details.

### fix_details Schema

In the impl report frontmatter:

```yaml
fix_details:
  retry_number: 1
  failures_addressed: [test_name_1]
  changes_made:
    - file: path/to/file
      fix: "description"
      line: 42
  ready_for_retest: true
```

---

## TRACE MARKERS

When requirement IDs are available in the sub-task's `reqs:` frontmatter or the dispatch
prompt:

`// @trace {ID} [Tn] brief description`

`{ID}` is whatever the sub-task's `reqs:` field carries, copied verbatim — `UC-001`,
`NFR-SEC-001`, `REQ-014`. Do not renumber or re-prefix it into a different scheme; the
prefix identifies the source document. See `rules/traceability.md`.

- Place immediately before function/class declaration
- One marker per function-level boundary (not every line)
- Skip entirely when `reqs:` is empty
- List the same IDs in the impl report's `requirements_satisfied` frontmatter
- Include `trace_markers_added` (number) in the impl report frontmatter

---

## CONSTRAINTS

| Rule | Enforcement |
|------|-------------|
| Platform skill first | Load swift/kotlin/flutter before coding |
| Design first | UI = must have specs |
| Test plan | Always write before post-tasks |
| Impl report | Always write before post-tasks — including on needs_info/blocked |
