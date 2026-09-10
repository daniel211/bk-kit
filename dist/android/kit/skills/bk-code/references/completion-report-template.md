# Feature Completion Report Template

bk-project-manager uses this template during finalize to generate completion reports.

## Template

```
# Feature Completion Report: {feature_name}

## Summary
- **Status:** {Completed | Partially Completed | Escalated}
- **Tier:** {Trivial | Standard | Complex}
- **Platform:** {platform}

## Implementation
| Sub-Task | Status | Files Changed | Tests | Review |
|----------|--------|---------------|-------|--------|

## Quality Metrics
- Test pass rate: {X}%
- Review findings: critical={N}, warning={N}, info={N}
- Fix loops: {N}
- Reactive signals dispatched: {list or 0}

## Requirement Coverage
(If traceability-matrix.md exists)
- Covered: {X}/{total} ({percentage}%)
- Not implemented: {list trace IDs if any}

## Known Issues / Tech Debt
(From deferred review warnings)

## Next Steps
(Auto-suggested based on outcome and project state)
```

## Field Definitions

| Field | Source | Notes |
|-------|--------|-------|
| `feature_name` | `.plan-state.json` → `feature` | Slug or human-readable name |
| `Status` | Sub-task statuses + batch completion | All complete = Completed; any blocked = Escalated |
| `Tier` | `.workflow-state.json` → `complexity_tier` | Trivial / Standard / Complex |
| `Platform` | `platform-context.json` → `platform` | ios / android / flutter |
| `Sub-Task Status` | `.plan-state.json` → each sub-task entry | completed / blocked / skipped |
| `Files Changed` | Union of each sub-task impl report's `files_changed` | Count of modified files |
| `Tests` | Test report from `reports/unit-test-*.md` | Pass/total format |
| `Review findings` | `reports/code-review-*.md` metadata | Parse severity counts |
| `Fix loops` | `.workflow-state.json` → `fix_loop_count` | Number of review→fix cycles |
| `Coverage %` | `traceability-matrix.md` → summary | Skip row if no matrix |

## Usage

During finalize, bk-project-manager:

1. Reads all source fields listed above
2. Fills template fields with actual data
3. Writes: `bk/dev/{feature}/completion-report.md`
4. Outputs 5-line summary to conductor

## 5-Line Summary Format (for conductor)

```
Feature: {feature_name} | Tier: {tier} | Status: {status}
Files changed: {N} | Tests: {pass}/{total} | Coverage: {N}%
Review: critical={N}, warning={N} | Fix loops: {N}
Tech debt: {count deferred warnings or 'none'}
Next: {top suggested next step}
```
