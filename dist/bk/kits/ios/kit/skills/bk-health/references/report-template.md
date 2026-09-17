# Health Report Template (bk-health Step 5)

Write `bk/docs/health-report.md` with priority-ordered findings:

```markdown
# Project Health Report
Generated: {ISO timestamp} | Mode: {quick|deep} | Project: {path}

## Summary
| Priority | Count | Areas |
|----------|-------|-------|
| Critical | N | {areas} |
| High | N | {areas} |
| Medium | N | {areas} |
| Low | N | {areas} |

## Dependency Freshness
{findings with file citations}

## Code Quality
### TODO/FIXME ({count} items)
{top 5 files with most items, with line citations}

### Large Files ({count} files > 500 LOC)
{file list with LOC count}

## Test Coverage
- Test ratio: {ratio} ({test_count} test files / {source_count} source files)
- Status: {OK|WARNING|CRITICAL}

## Architecture (Deep mode only)
{agent findings from bk-code-reviewer}

## Security (Deep mode only)
{agent findings from bk-security-auditor}

## Recommendations
(Priority ordered, actionable next steps)
1. [CRITICAL] ...
2. [HIGH] ...
3. [MEDIUM] ...
```

Priority levels:
- **Critical**: security vulnerabilities, zero test coverage
- **High**: deprecated APIs, severely outdated deps (> 365 days), large god files
- **Medium**: low test ratio, many TODO/FIXME items, stale deps (180-365 days)
- **Low**: style issues, minor code quality signals
