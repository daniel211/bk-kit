---
name: bk-agent-contract
description: "REQUIRED before dispatching agents. Defines agent I/O file contracts, the impl report schema, background agent limitations, output verification protocol, and workflow completion report format."
user-invocable: false
---

# Agent I/O Contract Skill

> Load when dispatching agents, verifying outputs, or understanding inter-agent data flow

---

## 1. IRON LAW

**"AGENT B NEEDS DATA FROM AGENT A → AGENT A MUST WRITE FILE → AGENT B READS FILE"**

| Rule | Description |
|------|-------------|
| IO-001 | Agent MUST read ALL input files before work |
| IO-002 | Agent MUST write ALL output files before return |
| IO-003 | Missing input → return `need_data`, do NOT assume |
| IO-004 | Output MUST have enough info for downstream |
| IO-005 | JSON output MUST have schema_version; markdown reports MUST have YAML frontmatter |

---

## 2. FILE STRUCTURE

```
bk/dev/
├── {feature}/
│   └── research/impl-sub-task-{NN}.md   # impl report — /bk-code
├── shared/
│   ├── design/{feature}-specs.md, -tokens.json
│   ├── api/{feature}-endpoints.json, -models.json
│   └── reports/
│       ├── impl-{feature}-debug.md      # impl report — /bk-debug
│       └── impl-{feature}-refactor.md   # impl report — /bk-refactor
├── research/{feature}-requirements.md
├── test-cases/{platform}-{feature}.md
└── checkpoints/
```

---

## 3. KEY OUTPUT SCHEMAS

### impl report (Dev → Test/Review/Docs/Commit)

**There is no `impl-result.json`.** One artifact per implementation dispatch: a markdown
report with YAML frontmatter. The frontmatter carries the machine-readable fields; the body
carries what a human (or a reviewer agent) needs to read. A dev agent that writes source
files but no impl report has not completed its dispatch.

| Command | Report path |
|---------|-------------|
| `/bk-code` | `{plan-dir}/research/impl-sub-task-{NN}.md` — one per sub-task |
| `/bk-debug` | `bk/dev/shared/reports/impl-{feature}-debug.md` |
| `/bk-refactor` | `bk/dev/shared/reports/impl-{feature}-refactor.md` |

One report per dispatch, never a shared file: two agents writing one path lose each other's
work. Consumers that need the whole feature read every matching report.

```md
---
schema_version: "2.0"
schema_type: impl-report
agent: bk-ios-developer
feature: login
sub_task: "02"                  # /bk-code only; omit for debug/refactor
status: complete                # complete | needs_info | blocked
timestamp: "2026-09-10T14:20:00Z"
build_verified: true            # true only if the build command actually ran and passed
requirements_satisfied: [REQ-login-001]
files_changed:
  - path: Login/LoginViewModel.swift
    change: created             # created | modified | deleted
    description: "State + validation for the login form"
skills_loaded: [bk-code-workflow, ios-clean-mvvm]
learnings: []                   # [{type, content}] — see bk-task-tracking
info_needed: []                 # required when status: needs_info
---

## Summary
{2-4 sentences: what was implemented and how it fits the sub-task scope.}

## Deviations from Expected Code
{Each deviation + why. "None" if the plan was followed as written.}

## Edge Cases Addressed
- {edge case → how it is handled}

## Anti-Patterns Avoided
- {anti-pattern → what was done instead}

## Notes for Reviewer
{Anything a reviewer would otherwise have to reverse-engineer: assumptions, known gaps,
files touched outside `owns` and why.}
```

**Partial work:** if critical information is missing, do not guess. Write the report with
`status: needs_info`, fill `info_needed`, and list whatever `files_changed` got done.
Same for `status: blocked`. A missing report is indistinguishable from a crashed agent;
a `needs_info` report is actionable.

**`build_verified` is a claim about a command that ran.** Never set it true from inspection.

**Reading it:** frontmatter is a claim, not evidence. Reviewers cross-validate against the
actual source — see `bk-code-review-workflow`.

### test-files.json (Test Agent → Main)

```json
{
  "schema_version": "2.0",
  "schema_type": "test-files",
  "execution_mode": "write_and_run",
  "test_files": [{"path": "...", "test_count": 15}],
  "execution_results": {"pass_count": 14, "fail_count": 1, "fix_cycles": 1, "failures": []},
  "run_commands": {"unit_test": "..."}
}
```

---

## 4. AGENT INPUT/OUTPUT MATRIX

| Agent | Required Input | Output |
|-------|----------------|--------|
| bk-researcher | Feature description | requirements.md |
| design-validator | Figma URL | discovery.json, component-contracts.json |
| design-spec-writer | Figma nodeId + slug | design.md (per screen) |
| design-asset-exporter | assets.json (from design.md) | platform asset folders + asset-export-report.json |
| api-integrator | API spec | endpoints.json, models.json |
| bk-{platform}-developer (e.g. bk-ios-developer) | requirements, design, api, spec_index | impl report (md) |
| bk-unit-test-agent | impl report(s), test-cases, spec_index | test-files.json |
| bk-code-reviewer | impl report(s), spec_index | code-review.md |
| security-auditor | impl report(s) | security.md |

---

## 5. BACKGROUND AGENT LIMITATIONS

```
Background agents CANNOT:
  ✗ Call LSP tools
  ✗ Call MCP servers
  ✗ Return need_data (use blocked status instead)

Background agents CAN:
  ✓ Read files (Glob, Grep, Read)
  ✓ Write files (Write, Edit)
  ✓ Execute commands (Bash)
```

Main MUST provide in prompt:
- All input file paths (absolute)
- Expected output file path
- Complete context (no "previous" references)

### Background Agent Status Protocol

| Status | When | Conductor Action |
|--------|------|-----------------|
| `complete` | Work done, output written | Verify + proceed |
| `partial` | Some work done, partial output | Assess → re-dispatch narrower scope OR proceed |
| `blocked` | Missing critical info | Read `{feature}-blocked.json` → provide info → re-dispatch |
| `failed` | Error occurred | Retry once simplified → escalate to user |

When blocked, write `{output-dir}/{feature}-blocked.json`:
```json
{"agent": "agent-type", "status": "blocked", "missing": ["what's needed"], "partial_output": "path"}
```

---

## Confidence Reporting (Required)

Every agent output MUST include confidence indicator in metadata footer:

```
<!-- metadata: {..., "confidence": "high|medium|low", "confidence_reason": "brief reason"} -->
```

### Definitions:
| Level | Range | Meaning | Conductor Action |
|-------|-------|---------|-----------------|
| high | >= 80% | Clear evidence, verified | Continue pipeline |
| medium | 50-79% | Some uncertainty | Log warning, monitor |
| low | < 50% | Significant uncertainty | Trigger reactive protocol |

### Examples:
- `"confidence": "high", "confidence_reason": "single clear root cause with reproducible test"`
- `"confidence": "medium", "confidence_reason": "2 possible causes, chose most likely based on evidence"`
- `"confidence": "low", "confidence_reason": "cannot reproduce issue, multiple possible causes"`

When confidence is LOW, conductor MUST check `rules/reactive-orchestration.md` before proceeding.

---

## 6. OUTPUT VERIFICATION

```
AFTER agent completes:
1. Read output file
2. Verify schema_version exists
3. Check required fields populated
4. Cross-check against task description
5. Verdict: ACCURATE / PARTIAL / MISMATCH
6. MISMATCH → re-dispatch immediately (max 2)
```

---

## 7. OUTPUT REVIEW PROTOCOL

| Agent | MUST verify | BLOCK if |
|-------|-------------|----------|
| unit-test-agent | test_files[] exist with real code | Files missing/empty |
| code-reviewer | files_actually_read[] = files_changed[] | Did not read code |

| Verdict | Condition | Action |
|---------|-----------|--------|
| ACCURATE | All checks pass | Proceed |
| PARTIAL | Minor issues, P0/P1 covered | Proceed + warn |
| MISMATCH | Files missing, empty, or code not read | Re-dispatch (max 2) |

---

## 8. WORKFLOW COMPLETION REPORT

Path: `bk/dev/shared/reports/workflow-report-{feature}.json`

```json
{
  "report_version": "1.0",
  "feature": "{name}",
  "generated_at": "ISO-8601",
  "summary": {
    "status": "SUCCESS|PARTIAL|FAILED",
    "tasks": {"total": 8, "completed": 8, "skipped": 0}
  },
  "files_changed": {
    "total": 5,
    "list": [{"path": "...", "change": "modified", "description": "..."}]
  },
  "test_results": {
    "unit": {"total": 10, "passed": 10, "failed": 0},
    "gate_status": "PASSED"
  },
  "review_summary": {
    "status": "approved|rejected",
    "issues_found": 2,
    "issues_fixed": 2
  },
  "impact_assessment": {
    "scope": "low|medium|high",
    "risk_level": "low"
  }
}
```

### Generate Logic

```
1. Read every impl report for the feature → union of `files_changed`
2. Read test-execution-*.json → test_results
3. Read code-review-*.json → review_summary
4. Calculate impact from impl data
5. Write workflow-report-{feature}.json
6. Display summary to user
```
