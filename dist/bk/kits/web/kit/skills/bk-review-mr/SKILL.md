---
name: bk-review-mr
description: "Review an MR/PR: diff two git branches (1 branch = vs develop) via bk-code-reviewer + optional bk-security-auditor."
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

## Execution

1. **Parse Arguments** — `SOURCE_BRANCH`, `TARGET_BRANCH` (default `develop`), optional
   `--srs <path>` → `SRS_PATH` (falls back to `bk/docs/srs/`, else `none`). `git fetch origin`,
   then `git rev-parse --verify` both branches — invalid branch → report and STOP.
   Load: `references/diff-preparation.md`

   **1b. Task Tracking** — `TaskCreate` a parent task `"Review MR: {SOURCE} -> {TARGET}"`;
   lifecycle per `Skill("bk-task-tracking")`.

2. **Get Diff File List** — `git diff --name-only origin/$TARGET...origin/$SOURCE`; empty diff →
   report "Không có thay đổi giữa ..." and STOP. Capture `--stat`, write the full patch to
   `bk/dev/shared/reports/mr-diff-{source-slug}.patch` (`{source-slug}` = branch with `/`→`-`).

3. **Load Foundation Context** — `bk/docs/foundation/architecture.md` + platform detection per
   `.claude/rules/core-rules.md` §1.

   **3b. Load SRS Context** (if `SRS_PATH != none`) — read the SRS file/dir, extract only the
   requirement IDs and acceptance criteria matching the changed files. Unreadable SRS → warn and
   continue; never stop.

4. **Detect Security-Sensitive Files** — changed paths matching auth, login, token, password,
   encrypt, keychain, storage, network, cert, pinning → also dispatch bk-security-auditor.
   Otherwise bk-code-reviewer only.

   **4b. Complexity Tiering** — `N < 30` → Standard (1 reviewer); `N >= 30` → Split (chunks of
   ~15 files, 1 reviewer per chunk, parallel, one chunk patch + sub-task each). The security
   auditor is dispatched once regardless of tier.
   Load: `references/diff-preparation.md` § Step 4b

5. **Dispatch Review Agents** — ALL agents in ONE message (background, sonnet). Every
   `bk-code-reviewer` MUST return a short `{c}C/{M}M/{m}m/{I}I — <=2 sentence` summary as its
   final message, in addition to writing its full JSON report to disk.
   Load: `references/review-dispatch.md`

6. **Collect and Report** — aggregate from the returned short summaries; read a full JSON report
   only when it has Critical findings or the user asks for detail. Verdict:
   no critical/major → ✅ Approved; major only → ⚠️ Changes requested; any critical → ❌ Blocked.
   Load: `references/report-format.md`

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

After each agent dispatch and return, check output for reactive signals. Helper skills available
at any point: **bk-brainstormer** (stuck on approach / architecture concern), **bk-docs-seeker**
(unknown API or framework error), **bk-sequential-thinking** (complex decomposition, conflicting
data), **bk-problem-solving** (fix loops, breakthrough needed).

**Decision tables:** `rules/reactive-orchestration.md`
