---
name: bk-code-workflow
description: "Development workflow patterns for mobile agents — Design-First Gate, output verification, FIX_REQUEST workflow, build commands per platform. Load alongside platform skills."
user-invocable: false
---

# Development Workflow Patterns

> Shared workflow patterns for development agents. Load alongside platform skills (swift, kotlin, flutter).

## DESIGN-FIRST GATE (BLOCKING — UI Features)

If the task involves Views, Screens, Widgets, or UI components, resolve design specs in this
order and **do not write UI code until one of them resolves**:

1. **`/bk-spec` output (canonical)** — `bk/dev/{feature}/design/*/design.md` +
   `.spec-state.json`. `design_review_verdict == "OKAY"` → proceed; `"REVISE"` / `design_partial`
   → proceed with warning + `design_verdict: REVISE` in the impl report; `design_cancelled` → 2.
2. **Legacy fallback** — `bk/dev/shared/design/{feature}-specs.md` + `{feature}-tokens.json`
   (both must exist) → proceed and log "DEPRECATED design path — migrate to /bk-spec".
3. **Inline guidance** — design details in the dispatch prompt → proceed, add
   `design_specs_missing: true` to the impl report.
4. **No specs anywhere** → **STOP**, return: `"Design specs required. Run /bk-spec --design first
   to extract Figma specs for this feature."`

**Never hardcode colors, fonts, or spacing without design tokens.**

Lookup detail + Design Token Validation: `references/design-gate.md`

## GATE CHECK: PLAN REQUIRED

Check `bk/dev/feature-*-plan.md` and `bk/dev/research/{feature}-requirements.md` exist before
implementing. Read each file you are about to edit first — what exists, where to add, which
patterns are used (Grep/Glob for symbols and for similar names, to avoid duplication).

## RETURNING TO MAIN (needs_info Protocol)

If critical information is missing after checking plan, specs, and design — do not guess. Write the
impl report anyway with `status: needs_info`, `info_needed: ["what's missing"]`, and whatever
`files_changed` got done. A missing report is indistinguishable from a crashed agent; a
`needs_info` report is actionable.

## SPEC READING PROTOCOL

When `spec_index_file` is provided: read the spec-index, read the mapped spec sections at their
`line_range`, address every `edge_cases[]`, avoid every `anti_patterns[]`, follow `samples[]`.
**STOP GATE**: spec-index provided AND your task ID appears nowhere → return an error, do not code.
Protocol + trace-marker rules (`// @trace {ID}`): `references/spec-reading.md`

## OUTPUT GATE: VERIFY BEFORE PROCEEDING (BLOCKING)

After coding, write these files before spawning post-tasks:

1. **The impl report** — one markdown file per dispatch. There is no `impl-result.json`.
2. `test-plan.md` — test specifications

### Impl Report

Write it to the path the dispatch prompt names. If none was given: `/bk-code` →
`{plan-dir}/research/impl-sub-task-{NN}.md`; `/bk-debug` →
`bk/dev/shared/reports/impl-{feature}-debug.md`; `/bk-refactor` →
`bk/dev/shared/reports/impl-{feature}-refactor.md`.
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

## FIX_REQUEST WORKFLOW

**Detection:** prompt contains "FIX TEST FAILURES", "retry #", "retry_count", a
`debug_artifacts` path, or a `suggested_fixes` array → this is a FIX_REQUEST, not normal
implementation.

1. **Read debug artifacts**: `{debug_artifacts}/debug-manifest.json` and logs
2. **Analyze failures**: parse failures, map to file locations, cross-reference with suggested_fixes
3. **Apply fixes**: read each file, apply the fix, check impact via Grep
4. **Verify locally** using the platform build command (`references/build-commands.md`)
5. **Update the impl report** — add the `fix_details` frontmatter field (schema in
   `references/build-commands.md`) and note the fix in `## Summary`

Build retry: max 3 per failure, then return `status: "partial"` with error details.

## CONSTRAINTS

| Rule | Enforcement |
|------|-------------|
| Platform skill first | Load swift/kotlin/flutter before coding |
| Design first | UI = must have specs |
| Test plan | Always write before post-tasks |
| Impl report | Always write before post-tasks — including on needs_info/blocked |
