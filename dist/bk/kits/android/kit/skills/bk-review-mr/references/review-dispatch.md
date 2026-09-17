# Review Agent Dispatch (bk-review-mr Step 5)

Dispatch all agents in ONE message (background, sonnet). In Split tier this means N chunk agents
(+ optional security auditor) all in the same message.

`TaskUpdate` each corresponding task (parent, and chunk sub-tasks if Split tier) to `in_progress`
immediately before this dispatch.

Every `bk-code-reviewer` dispatch (Standard or per-chunk) MUST instruct the agent to return, as
its final message, a **short summary** in addition to writing the full JSON report to disk:

```
{critical}C/{major}M/{minor}m/{info}I — <=2 sentence summary of the top issue(s), or "no significant findings"
```

This keeps the conductor from reading every full JSON report back into context — see Step 6.

## Always: bk-code-reviewer

Standard tier — whole file list. Split tier — repeat this same template once per chunk with
`{file_list}` = the chunk's files, `Diff patch` = the chunk patch path, `Output` = the chunk
report path.

```
Task(subagent_type: "bk-code-reviewer", model: "sonnet", run_in_background: true, prompt: "
  TOOL RESTRICTION: You are a READ-ONLY agent. Do NOT use Edit, Bash, or Task tools.

  MR Review Task:
  Source branch: {SOURCE_BRANCH}
  Target branch: {TARGET_BRANCH}
  Platform: {platform}

  Changed files:
  {file_list — one per line}

  Diff patch: bk/dev/shared/reports/mr-diff-{source-slug}.patch

  Architecture rules: .claude/rules/{platform}-rules.md
  Architecture doc: bk/docs/foundation/architecture.md
  SRS docs: {SRS_PATH, or 'none — skip SRS compliance check'}

  Review focus:
  - Code correctness and logic errors
  - Architecture compliance (Clean Architecture, MVVM)
  - Naming conventions and code style
  - Error handling and edge cases
  - Potential regressions in existing functionality
  - Performance concerns
  - SRS compliance (only if SRS docs provided): for each changed file, check the implemented business logic
    against the matching functional requirement / use case / acceptance criteria in the SRS docs.
    Flag as a finding (severity Major or Critical per impact) any:
    - Requirement described in SRS but not implemented (missing logic)
    - Implemented logic that contradicts or diverges from SRS acceptance criteria
    - Edge case / validation rule specified in SRS but absent in code
    Cite the SRS requirement ID/section in each such finding.

  Output: bk/dev/shared/reports/code-review-mr-{source-slug}.json (Split tier: code-review-mr-{source-slug}-chunk{i}.json)

  Report back (final message, in addition to writing the JSON): '{critical}C/{major}M/{minor}m/{info}I — <=2 sentence summary of top issue(s), or \"no significant findings\"'
")
```

## Conditional: security-sensitive changes

```
Task(subagent_type: "bk-security-auditor", model: "sonnet", run_in_background: true, prompt: "
  TOOL RESTRICTION: You are a READ-ONLY agent. Do NOT use Edit, Bash, or Task tools.

  MR Security Audit:
  Source branch: {SOURCE_BRANCH}
  Target branch: {TARGET_BRANCH}
  Platform: {platform}

  Changed files (security-sensitive):
  {security_file_list}

  Diff patch: bk/dev/shared/reports/mr-diff-{source-slug}.patch

  Output: bk/dev/shared/reports/security-mr-{source-slug}.json
")
```
