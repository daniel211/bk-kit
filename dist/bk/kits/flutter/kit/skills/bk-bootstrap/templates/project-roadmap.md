# Project Roadmap (detected)

## Current State

| Metric | Value |
|--------|-------|
| Total LOC | {{totalLoc}} |
| Total Files | {{totalFiles}} |
| Test Coverage | {{testCoverage}} |
| Tech Debt Indicators | {{techDebtCount}} |

## Detected TODOs / FIXMEs

| Priority | Count | Top Files |
|----------|-------|-----------|
{{#each todoSummary}}
| {{priority}} | {{count}} | {{topFiles}} |
{{/each}}

## Suggested Improvements

{{#each improvements}}
### {{title}}
- **Impact**: {{impact}}
- **Effort**: {{effort}}
- **Evidence**: {{evidence}}
- **Recommendation**: {{recommendation}}
{{/each}}

## Migration Opportunities

{{#each migrations}}
- **{{from}}** → **{{to}}**: {{reason}} ({{effort}} effort)
{{/each}}
