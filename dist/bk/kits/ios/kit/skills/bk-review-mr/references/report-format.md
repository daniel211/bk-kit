# Aggregation & Report Format (bk-review-mr Step 6)

As each agent returns, `TaskUpdate` its task (chunk sub-task, or the single Standard-tier task) to
`completed`. Once all agents (all chunks + optional security auditor) have returned, `TaskUpdate`
the parent tracking task to `completed`.

Aggregate using the **short summaries returned by each agent call** — do NOT read every full JSON
report back into context. Only read a chunk's (or Standard's) full JSON report from disk when:
- its summary reports Critical findings (full detail is needed to relay to the user or feed a fix
  loop), or
- the user explicitly asks for full detail on a specific file or finding.

Sum severity counts across all returned summaries for the aggregate table.

## Report header

```
## MR Review: `{SOURCE_BRANCH}` → `{TARGET_BRANCH}`

Changed files: {N}
Lines added: +{N}  Lines removed: -{N}
```

If Split tier was used, add: `Reviewed in {K} parallel chunks (~15 files/chunk)`

## Severity levels

- Critical: must fix before merge
- Major: strongly recommended to fix
- Minor: nice to have
- Info: observations only

Show a summary table with finding counts by severity (aggregated across all chunks in Split tier).
If SRS was loaded, add a dedicated "SRS Compliance" row listing requirement IDs with
mismatched/missing logic. For any chunk whose full JSON was read (per the Critical-findings rule
above), fold its detailed findings into the report body under a subheading per chunk/file.

## Verdict

- `critical == 0 AND major == 0` → ✅ **Approved** — safe to merge
- `critical == 0 AND major > 0` → ⚠️ **Changes requested** — review major findings
- `critical > 0` → ❌ **Blocked** — must fix critical issues before merge

If there are critical/major findings, suggest a `/bk-debug` or `/bk-code` fix loop on the source
branch.
