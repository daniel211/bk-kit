---
name: bk-agent-contract
description: "REQUIRED before dispatching agents. Defines agent I/O file contracts, impl-result.json schema, background agent limitations, output verification protocol, and workflow completion report format."
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
| IO-005 | JSON output MUST have schema_version |

---

## 2. FILE STRUCTURE

```
bk/dev/
├── shared/
│   ├── design/{feature}-specs.md, -tokens.json
│   ├── api/{feature}-endpoints.json, -models.json
│   ├── {platform}/{feature}-impl-result.json
│   └── reports/
├── research/{feature}-requirements.md
├── test-cases/{platform}-{feature}.md
└── checkpoints/
```

---

## 3. KEY OUTPUT SCHEMAS

### impl-result.json (Dev → Test/Quality)

```json
{
  "schema_version": "1.0",
  "agent": "main",
  "feature": "login",
  "requirements_satisfied": ["REQ-001"],
  "spec_sections_read": ["SEC-001"],
  "edge_cases_addressed": ["Token refresh during network interruption"],
  "anti_patterns_avoided": ["Storing tokens in plaintext"],
  "files_changed": [
    {"path": "...", "change": "created", "description": "..."}
  ],
  "test_plan": "bk/dev/test-cases/{platform}-login.md"
}
```

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
| bk-{platform}-developer (e.g. bk-ios-developer) | requirements, design, api, spec_index | impl-result.json |
| bk-unit-test-agent | impl-result, test-cases, spec_index | test-files.json |
| bk-code-reviewer | impl-result, spec_index | code-review.md |
| security-auditor | impl-result | security.md |

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
1. Read impl-result.json → files_changed
2. Read test-execution-*.json → test_results
3. Read code-review-*.json → review_summary
4. Calculate impact from impl data
5. Write workflow-report-{feature}.json
6. Display summary to user
```
