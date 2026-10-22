# Enterprise Document Detection & Dispatch (bk-plan Step 4b)

Detect enterprise documentation in well-known directories, then dispatch `Explore` (background)
to extract it. This is **document EXTRACTION** — distinct from Step 6, which is domain/platform
RESEARCH via bk-researcher.

## Paths to scan

```
PRD/BRD:        bk/docs/product/prds/, bk/docs/requirements/, bk/docs/brd/
Test specs:     bk/docs/deliverables/testing/, bk/docs/test-cases/, bk/docs/qa/
Architecture:   bk/docs/product/architecture/, bk/docs/architecture/
API specs:      bk/docs/api/, bk/docs/openapi/
User stories:   bk/docs/stories/, bk/docs/user-stories/
```

## Dispatch

```
IF any enterprise doc directories found:
  Task(
    subagent_type: "Explore",
    model: "sonnet",
    run_in_background: true,
    description: "Read and summarize enterprise docs for {feature}",
    prompt: "
      Read enterprise documentation relevant to feature: {feature}

      Directories to scan:
      {list of detected enterprise doc paths}

      For each document found:
      1. Read full content
      2. Extract sections relevant to '{feature}'
      3. Identify: requirements (functional + non-functional),
         test specifications, architecture constraints,
         acceptance criteria, dependency notes

      ID rule: if the source document already numbers its requirements, keep that ID
      verbatim. Only mint `REQ-{NNN}` / `TC-{NNN}` for items the document leaves
      unnumbered, and never reuse an ID that a /bk-spec SRS already assigned
      (UC-/NFR-). See rules/traceability.md.

      Output — write to: {plan-dir}/inputs/requirements.json
      Format:
      {
        "source_docs": ["path1.md", "path2.md"],
        "requirements": [
          {"id": "REQ-001", "type": "functional|nonfunctional",
           "description": "...", "source": "path", "source_id": "original ID if the doc had one",
           "priority": "P0|P1|P2"}
        ],
        "test_specs": [
          {"id": "TC-001", "description": "...", "type": "unit|integration|e2e",
           "source": "path"}
        ],
        "architecture_constraints": ["..."],
        "acceptance_criteria": ["..."]
      }

      Also write summary to: {plan-dir}/research/enterprise-docs-summary.md
    "
  )
```

## Feeding enterprise data into plan synthesis

- `requirements.json` → sub-task `reqs:` fields for traceability (IDs verbatim)
- `test_specs` → sub-task Test Plan sections (pre-populated test cases)
- `architecture_constraints` → `plan.md ## Constraints` + sub-task review checklists
- `acceptance_criteria` → sub-task Success Criteria sections
