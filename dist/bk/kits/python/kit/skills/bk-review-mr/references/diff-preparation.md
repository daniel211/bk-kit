# Diff Preparation (bk-review-mr Steps 1–3b)

## Step 1: Parse Arguments

Parse `$ARGUMENTS`:
- Strip an optional `--srs <path>` flag first (path may be a file or a directory) → `SRS_PATH`
- Remaining positional args:
  - **Two arguments** (e.g. `feature/my-branch develop`): `SOURCE_BRANCH=$1`, `TARGET_BRANCH=$2`
  - **One argument** (e.g. `feature/my-branch`): `SOURCE_BRANCH=$1`, `TARGET_BRANCH=develop`
  - **No arguments**: ask the user — "Bạn muốn review nhánh nào? `/bk-review-mr <source-branch> [target-branch] [--srs <path>]`"

Resolve `SRS_PATH`:
- If `--srs <path>` given, use it as-is (file or directory).
- Else if `bk/docs/srs/` exists, default `SRS_PATH=bk/docs/srs/`.
- Else `SRS_PATH=none` — review proceeds without SRS-based logic checks (skip Step 3b, omit the
  SRS review focus in dispatch prompts).

Validate branches exist:
```bash
git fetch origin
git rev-parse --verify origin/$SOURCE_BRANCH  # must exist
git rev-parse --verify origin/$TARGET_BRANCH  # must exist
```

If either branch is not found, report the error and stop. Do NOT proceed with an invalid branch.

## Step 1b: Task Tracking Setup

`TaskCreate` a parent tracking task: subject `"Review MR: {SOURCE_BRANCH} -> {TARGET_BRANCH}"`,
description including branches + SRS path. Mark `in_progress` once dispatch begins (Step 5),
`completed` once Step 6 finishes aggregating all agent results (chunk sub-tasks, if any, are
created in Step 4b). Follow the lifecycle from `Skill("bk-task-tracking")` — reuse
`TaskCreate`/`TaskUpdate`/`TaskList`, no new mechanism.

## Step 2: Get Diff File List

```bash
git diff --name-only origin/$TARGET_BRANCH...origin/$SOURCE_BRANCH
```

If the diff is empty, report "Không có thay đổi giữa `$SOURCE_BRANCH` và `$TARGET_BRANCH`." and stop.

Capture diff stats for context:
```bash
git diff --stat origin/$TARGET_BRANCH...origin/$SOURCE_BRANCH
```

Generate the full diff for reviewers:
```bash
git diff origin/$TARGET_BRANCH...origin/$SOURCE_BRANCH > bk/dev/shared/reports/mr-diff-{source-slug}.patch
```

Where `{source-slug}` = SOURCE_BRANCH with `/` replaced by `-`.

## Step 3: Load Foundation Context

1. Read `bk/docs/foundation/architecture.md` (if it exists) — pass patterns to reviewers
2. Detect platform per `.claude/rules/core-rules.md` section 1

## Step 3b: Load SRS Context (if `SRS_PATH != none`)

1. If `SRS_PATH` is a directory, list and read all `.md` files inside (typically `overview.md`,
   `functional-requirements.md`, `nonfunctional-requirements.md`, `api-contract.md`,
   `ui-ux-requirements.md` per the `bk-srs` output contract). If it is a single file, read only it.
2. Extract requirement IDs and acceptance criteria relevant to the changed files (match by
   feature/screen/use-case name, not a full-text dump — keep prompt size bounded).
3. If `SRS_PATH` resolves to nothing readable, report "SRS không tìm thấy tại `{SRS_PATH}` —
   review sẽ bỏ qua kiểm tra logic theo SRS." and continue without it (never stop the workflow).

## Step 4b: Complexity Tiering

Count changed files `N` from the Step 2 file list:

| Tier | Condition | Dispatch |
|------|-----------|----------|
| **Standard** | `N < 30` | 1 `bk-code-reviewer` for the whole file list |
| **Split** | `N >= 30` | Split the file list into chunks of ~15 files (last chunk may be smaller); 1 `bk-code-reviewer` per chunk, dispatched in parallel |

Splitting rule: a simple even split by position in the file list (chunk size 15) — not grouped by
module/folder. Deterministic, and it avoids uneven chunks.

For **Split tier** only:
- Per chunk, generate a chunk-scoped diff:
  `git diff origin/$TARGET_BRANCH...origin/$SOURCE_BRANCH -- {chunk_files}` →
  `bk/dev/shared/reports/mr-diff-{source-slug}-chunk{i}.patch`
- `TaskCreate` one sub-task per chunk (subject `"Review chunk {i}/{K}: {file_count} files"`,
  unblocked, all parallel), linked under the Step 1b parent tracking task.
- The optional `bk-security-auditor` is dispatched ONCE against the full security-sensitive file
  list regardless of tier — it is a narrower set already, so splitting adds no value.
