# Spec Reading Protocol (bk-code-workflow)

Applies when the dispatch prompt provides `spec_index_file`.

1. Read the spec-index, find the sections mapped to your task IDs
2. Read the original spec files at each section's `line_range`
3. Address every `edge_cases[]` item, avoid every `anti_patterns[]` item, follow `samples[]`
4. Report in the impl report: `spec_sections_read` (frontmatter), `## Edge Cases Addressed`,
   `## Anti-Patterns Avoided`

**STOP GATE**: if a spec-index is provided AND your task ID appears nowhere in it → return an
error and do not code.

## Trace Markers

When requirement IDs are available in the sub-task's `reqs:` frontmatter or in the dispatch prompt:

`// @trace {ID} [Tn] brief description`

`{ID}` is whatever the sub-task's `reqs:` field carries, copied verbatim — `UC-001`,
`NFR-SEC-001`, `REQ-014`. Do not renumber or re-prefix it into a different scheme; the prefix
identifies the source document. See `rules/traceability.md`.

- Place the marker immediately before the function/class declaration
- One marker per function-level boundary (not every line)
- Skip entirely when `reqs:` is empty
- List the same IDs in the impl report's `requirements_satisfied` frontmatter
- Include `trace_markers_added` (number) in the impl report frontmatter
