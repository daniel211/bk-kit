---
name: bk-review-mr
description: "Review code changes between two git branches (MR/PR review). Accepts 1 or 2 branch names — single branch diffs against develop. Delegates to bk-code-reviewer + optional bk-security-auditor."
user-invocable: true
argument-hint: "<source-branch> [<target-branch>] [--srs <path>]"
---

# MR Review: $ARGUMENTS

Review code changes between two git branches, simulating a Merge Request review.
Accepts one or two branch arguments. Single branch diffs against `develop` by default.

Delegates to `bk-review` agents (bk-code-reviewer + optional bk-security-auditor). Read-only analysis — no code changes.

<Use_When>
- User wants to review a Merge Request / Pull Request
- User says "review MR", "review PR", "review branch", "diff branches"
- User provides one or two branch names as arguments
- Pre-merge quality gate before merging a feature branch
- User invokes `/bk-review-mr <branch>` or `/bk-review-mr <source> <target>`
</Use_When>

<Do_Not_Use_When>
- No branch specified — ask user for branch name first
- Tests needed — use /bk-test
- Bug fix — use /bk-debug
- Review of local uncommitted changes only — use /bk-review
</Do_Not_Use_When>

## Approval Gates

Per `.claude/rules/approval-rules.md`: review is No-risk — auto-approve, no gate needed.

---

## Execution

### Step 1: Parse Arguments

Parse `$ARGUMENTS`:
- Strip out an optional `--srs <path>` flag first (path may be a file or a directory) → `SRS_PATH`
- Remaining positional args:
  - **Two arguments** (e.g. `feature/my-branch develop`): `SOURCE_BRANCH=$1`, `TARGET_BRANCH=$2`
  - **One argument** (e.g. `feature/my-branch`): `SOURCE_BRANCH=$1`, `TARGET_BRANCH=develop`
  - **No arguments**: ask user — "Bạn muốn review nhánh nào? `/bk-review-mr <source-branch> [target-branch] [--srs <path>]`"

Resolve `SRS_PATH`:
- If `--srs <path>` given, use it as-is (file or directory).
- Else if `bk/docs/srs/` exists, default `SRS_PATH=bk/docs/srs/`.
- Else `SRS_PATH=none` — review proceeds without SRS-based logic checks (skip Step 3b, omit SRS review focus in dispatch prompts).

Validate branches exist:
```bash
git fetch origin
git rev-parse --verify origin/$SOURCE_BRANCH  # must exist
git rev-parse --verify origin/$TARGET_BRANCH  # must exist
```

If either branch not found, report error and stop. Do NOT proceed with invalid branch.

### Step 1b: Task Tracking Setup

`TaskCreate` a parent tracking task: subject `"Review MR: {SOURCE_BRANCH} -> {TARGET_BRANCH}"`, description including branches + SRS path. Mark `in_progress` once dispatch begins (Step 5), `completed` once Step 6 finishes aggregating all agent results (chunk sub-tasks, if any, created in Step 4b). Follow lifecycle from `Skill("bk-task-tracking")` — reuse `TaskCreate`/`TaskUpdate`/`TaskList`, no new mechanism.

### Step 2: Get Diff File List

```bash
git diff --name-only origin/$TARGET_BRANCH...origin/$SOURCE_BRANCH
```

If diff is empty, report: "Không có thay đổi giữa `$SOURCE_BRANCH` và `$TARGET_BRANCH`." and stop.

Capture diff stats for context:
```bash
git diff --stat origin/$TARGET_BRANCH...origin/$SOURCE_BRANCH
```

Generate full diff for reviewers:
```bash
git diff origin/$TARGET_BRANCH...origin/$SOURCE_BRANCH > bk/dev/shared/reports/mr-diff-{source-slug}.patch
```

Where `{source-slug}` = SOURCE_BRANCH with `/` replaced by `-`.

### Step 3: Load Foundation Context

1. Read `bk/docs/foundation/architecture.md` (if exists) — pass patterns to reviewers
2. Detect platform per `.claude/rules/core-rules.md` section 1

### Step 3b: Load SRS Context (if `SRS_PATH != none`)

1. If `SRS_PATH` is a directory, list and read all `.md` files inside (typically `overview.md`, `functional-requirements.md`, `nonfunctional-requirements.md`, `api-contract.md`, `ui-ux-requirements.md` per `bk-srs` output contract). If it's a single file, read that file only.
2. Extract requirement IDs and acceptance criteria relevant to the changed files (match by feature/screen/use-case name, not full-text dump — keep prompt size bounded).
3. If `SRS_PATH` resolves to nothing readable, report: "SRS không tìm thấy tại `{SRS_PATH}` — review sẽ bỏ qua kiểm tra logic theo SRS." and continue without it (do not stop the workflow).

### Step 4: Detect Security-Sensitive Files

Scan changed file paths for security keywords:
- auth, login, token, password, encrypt, keychain, storage, network, cert, pinning → dispatch bk-security-auditor
- Otherwise → bk-code-reviewer only

### Step 4b: Complexity Tiering

Count changed files `N` from Step 2's file list:

| Tier | Condition | Dispatch |
|------|-----------|----------|
| **Standard** | `N < 30` | 1 `bk-code-reviewer` for the whole file list (unchanged from before) |
| **Split** | `N >= 30` | Split file list into chunks of ~15 files each (last chunk may be smaller); 1 `bk-code-reviewer` per chunk, dispatched in parallel |

Splitting rule: simple even split by position in the file list (chunk size 15) — not grouped by module/folder. Deterministic and avoids uneven chunks.

For **Split tier** only:
- For each chunk, generate a chunk-scoped diff: `git diff origin/$TARGET_BRANCH...origin/$SOURCE_BRANCH -- {chunk_files}` → `bk/dev/shared/reports/mr-diff-{source-slug}-chunk{i}.patch`
- `TaskCreate` one sub-task per chunk (subject `"Review chunk {i}/{K}: {file_count} files"`, unblocked, all parallel), linked under the parent tracking task from Step 1b.
- The optional `bk-security-auditor` from Step 4 is dispatched ONCE against the full security-sensitive file list regardless of tier — it is a narrower set already, splitting it adds no value.

### Step 5: Dispatch Review Agents

Dispatch all agents in ONE message (background, sonnet). In Split tier this means N chunk agents (+ optional security auditor) all in the same message.

`TaskUpdate` each corresponding task (parent, and chunk sub-tasks if Split tier) to `in_progress` immediately before this dispatch.

Every `bk-code-reviewer` dispatch (Standard or per-chunk) MUST instruct the agent to return, as its final message, a **short summary** in addition to writing the full JSON report to disk:
```
{critical}C/{major}M/{minor}m/{info}I — <=2 sentence summary of the top issue(s), or "no significant findings"
```
This keeps the conductor from needing to read every full JSON report back into context — see Step 6.

**Always dispatch bk-code-reviewer** (Standard tier — whole file list; for Split tier, repeat this same template once per chunk with `{file_list}` = chunk's files, `Diff patch` = chunk patch path, `Output` = chunk report path):
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

**Conditional — security-sensitive changes:**
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

### Step 6: Collect and Report

As each agent returns, `TaskUpdate` its task (chunk sub-task, or the single Standard-tier task) to `completed`. Once all agents (all chunks + optional security auditor) have returned, `TaskUpdate` the parent tracking task to `completed`.

Aggregate using the **short summaries returned by each agent call** — do NOT read every full JSON report back into context. Only read a chunk's/standard's full JSON report file from disk when:
- its summary reports Critical findings (need full detail to relay to the user / feed a fix loop), or
- the user explicitly asks for full detail on a specific file or finding.

Sum severity counts across all returned summaries for the aggregate table below.

**Report header:**
```
## MR Review: `{SOURCE_BRANCH}` → `{TARGET_BRANCH}`

Changed files: {N}
Lines added: +{N}  Lines removed: -{N}
```
If Split tier was used, add: `Reviewed in {K} parallel chunks (~15 files/chunk)`

**Severity levels:**
- Critical: must fix before merge
- Major: strongly recommended to fix
- Minor: nice to have
- Info: observations only

Show summary table with finding counts by severity (aggregated across all chunks if Split tier). If SRS was loaded, add a dedicated "SRS Compliance" row listing requirement IDs with mismatched/missing logic. For any chunk whose full JSON was read (per the Critical-findings rule above), fold its detailed findings into the report body under a subheading per chunk/file.

**Verdict:**
- `critical == 0 AND major == 0` → ✅ **Approved** — safe to merge
- `critical == 0 AND major > 0` → ⚠️ **Changes requested** — review major findings
- `critical > 0` → ❌ **Blocked** — must fix critical issues before merge

If critical/major findings: suggest `/bk-debug` or `/bk-code` fix loop on source branch.

## Output Files

| File | Description |
|------|-------------|
| `bk/dev/shared/reports/mr-diff-{source-slug}.patch` | Raw git diff patch (Standard tier, whole diff) |
| `bk/dev/shared/reports/code-review-mr-{source-slug}.json` | Code review findings (Standard tier) |
| `bk/dev/shared/reports/security-mr-{source-slug}.json` | Security findings (optional) |
| `bk/dev/shared/reports/mr-diff-{source-slug}-chunk{i}.patch` | Per-chunk diff patch (Split tier only, `i` = 1..K) |
| `bk/dev/shared/reports/code-review-mr-{source-slug}-chunk{i}.json` | Per-chunk code review findings (Split tier only) |

## Constraints

- Auto-approve — no user gate required
- Both review agents are READ-ONLY — MUST NOT use Edit, Bash, or Task tools
- Single-message batching: dispatch ALL review agents in ONE message (all chunks + optional security auditor together, even in Split tier)
- Always `git fetch origin` before diffing — never use stale local refs
- Use three-dot diff (`A...B`) for MR-style comparison (changes on source since branch point)
- SRS lookup is best-effort: missing/unreadable SRS never blocks the review, only narrows its scope
- Complexity tiering threshold: `N >= 30` changed files triggers Split tier; chunk size ~15 files. Tune these two numbers in Step 4b if needed.
- Every `bk-code-reviewer` dispatch MUST return a short severity-count summary as its final message (in addition to writing the full JSON report to disk) — see Step 5
- Main MUST NOT read a chunk's full JSON report unless it has Critical findings or the user asks for detail — keeps large-MR review token-light

## References

- Base review skill: `.claude/skills/bk-review/SKILL.md`
- Approval rules: `.claude/rules/approval-rules.md`
- Tool restriction (read-only agents): `.claude/rules/agent-protocols/tool-restriction.md`
- Output gate: `.claude/rules/agent-protocols/output-gate.md`
- Agent contract: `Skill("bk-agent-contract")`
- Task tracking lifecycle: `Skill("bk-task-tracking")`

## Reactive Orchestration Reminder

After each agent dispatch and return, check output for reactive signals.

**Helper skills available at any point:**
- **bk-brainstormer** — agent stuck on approach, architecture concern
- **bk-docs-seeker** — unknown API/framework error
- **bk-sequential-thinking** — complex decomposition, conflicting data
- **bk-problem-solving** — creative breakthrough needed, fix loops

**Decision tables:** `rules/reactive-orchestration.md`
