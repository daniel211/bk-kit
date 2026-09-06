---
paths:
  - bk/dev/shared/reports/**
---

# Output Gate Protocol

> Verify output files are written as Markdown with metadata footer before returning "complete".

## Before Returning "complete"

1. **Write the output file** using Write tool. Do not just describe — actually call Write.
2. **Read the file back** to confirm it was written correctly.
3. **Check structure**: `## ` header present, `<!-- metadata: {...} -->` footer present.
4. **Cross-check** output matches assigned task (feature, platform, scope).

## Report Template

```markdown
## {Report Type}: {feature}
**Platform**: {platform} | **Files**: {count} | **Agent**: {agent_type}

### Findings
1. **[CRITICAL]** {description} — {location}
2. **[WARNING]** {description} — {location}

### Summary
| Metric | Value |
|--------|-------|
| {metric} | {value} |

<!-- metadata: {"schema_type":"{type}","agent":"{agent}","findings_count":{n},"timestamp":"{iso}"} -->
```

## Verdict

| Verdict | Meaning | Action |
|---------|---------|--------|
| ACCURATE | Header + metadata present, content populated | Return `"status": "complete"` |
| PARTIAL | Missing header or metadata footer | Fix, re-verify |
| MISMATCH | Wrong feature/platform | Rewrite, re-verify |

On MISMATCH: fix before returning. Never return "complete" with mismatched output.

## Output File Paths

| Agent | Output Path |
|-------|-------------|
| bk-unit-test-agent | `bk/dev/shared/reports/unit-test-{platform}-{feature}.md` |
| bk-device-test-agent | `bk/dev/shared/reports/device-test-{platform}-{feature}.md` |
| bk-code-reviewer | `bk/dev/shared/reports/code-review-{feature}.md` |
| bk-gemini-reviewer | `bk/dev/shared/reports/code-review-gemini-{feature}.md` |
| bk-security-auditor | `bk/dev/shared/reports/security-{feature}.md` |
| bk-performance-analyzer | `bk/dev/shared/reports/performance-{feature}.md` |
| bk-test-architect | `bk/dev/shared/reports/test-strategy-{feature}.md` |

## Agent-Specific Checks

| Agent | Required Sections | Notes |
|-------|-------------------|-------|
| bk-code-reviewer | `### Findings`, `### Summary` | Findings table with severity + file + line |
| bk-unit-test-agent | `### Test Results` | Test file list not empty |
| bk-security-auditor | `### Vulnerabilities`, `### Summary` | Vulnerabilities table with OWASP category |
| bk-performance-analyzer | `### Findings`, `### Summary` | Findings with impact estimate + effort |
| Dev agents | N/A | `impl-result.json` with implementation summary |

## Common Mistakes

- Describing output in text instead of calling Write
- Returning "complete" before Write finishes
- Writing to wrong path (typo in feature/platform name)
- Missing `<!-- metadata: ... -->` footer (required for machine parsing)
- Writing JSON instead of Markdown (legacy habit)

## Quality Dimensions

Every agent output must meet the minimum bar on these dimensions:

| Dimension | Minimum Bar | Check Method |
|-----------|------------|-------------|
| Completeness | All required sections have content | Required sections check |
| Evidence | Every finding cites file path + line | Grep for file references |
| Actionability | Findings have severity + recommended action | Pattern: [CRITICAL]/[WARNING] + action |
| Specificity | No generic phrases ("looks good", "seems fine") | Anti-pattern grep |
| Accuracy | Platform/feature name matches task assignment | Cross-check metadata |

### Anti-Patterns in Output (REJECT if found)

- "The code looks good overall" → Must have specific findings
- "No major issues found" without evidence → Must scan actual files
- Generic recommendations that don’t reference the codebase → Must cite files
- Copy-paste from template without customization → Must fill with real data
- Excessive "Not detected" fields (>3) → Scan was likely incomplete
- Leftover placeholders: `{{...}}`, `TODO:`, `TBD`, `PLACEHOLDER`
