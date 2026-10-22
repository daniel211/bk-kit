---
name: bk-commit
description: "Hook-guarded commit workflow — security check, diff summary, user approval gate, dispatch bk-git-manager, optional PR creation."
user-invocable: true
argument-hint: "[optional: commit message or feature name]"
---

# Commit: $ARGUMENTS

Security-checked, user-approved commit workflow. Shows diff summary, requires explicit user approval, then dispatches bk-git-manager (haiku) to create the commit. Optionally creates a PR via `gh` CLI.

<Use_When>
- User wants to commit staged or unstaged changes
- User says "commit", "save", "push", "create PR"
- End of a workflow — after implementation and review
- User invokes `/bk-commit [optional message]`
</Use_When>

<Do_Not_Use_When>
- Code not yet reviewed — run /bk-review first
- Tests not passing — run /bk-test first
</Do_Not_Use_When>

## Approval Gates

Per `.claude/rules/approval-rules.md`: commit is Low risk — commit gate always required.
Security check is enforced by hook (`security-check.sh`) on every file write/edit.

---

## Execution

### Step 1: Security Pre-check (Hook-enforced)

The `security-check.sh` hook automatically scans for:
- Protected files: `.env`, `*.key`, `*.pem`, `credentials.json`
- Secret patterns: AWS keys, GitHub tokens, private keys
- Protected dirs: `Certificates/`, `provisioning_profiles/`

If any protected content is detected: **STOP immediately** — do not proceed to commit.
Report which file/pattern triggered the block. Ask user to remove secrets before retrying.

### Step 2: Deep Secret Scan

Run expanded regex scan on the staged diff content:
```bash
git diff --cached | grep -inE \
  "(AKIA[A-Z0-9]{16}|AIza[0-9A-Za-z_-]{35}|ghp_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9_]{82}|glpat-[a-zA-Z0-9_-]{20}|xox[bpoas]-[a-zA-Z0-9-]+|sk-[a-zA-Z0-9]{48}|sk-ant-[a-zA-Z0-9_-]{95}|-----BEGIN (RSA|EC|OPENSSH) PRIVATE KEY|(password|secret|token|api_key)\s*[:=]\s*[A-Za-z0-9+\/=]{20,}|(mongodb|postgres|mysql|redis)://[^:]+:[^@]+@)"
```

If any match is found: **BLOCK commit immediately** — show matched lines with file path and line number. Ask user to remove secrets before retrying. Never suggest `--no-verify`.

See `references/secret-scan-patterns.md` for full pattern list and false-positive guidance.

### Step 3: Auto-Split Analysis

Analyze staged changes to detect multi-scope or mixed-type commits:
```bash
git diff --cached --name-only   # file list
git diff --cached --stat        # change summary
```

1. Group files by directory (scope) and infer change type (feat/fix/refactor/test/docs/chore)
2. Apply split rules: split if >1 type mixed, >1 unrelated scope, config+code mixed, or >10 unrelated files
3. Skip split if: same type/scope, ≤3 files, ≤50 lines total

If split is recommended, **use `AskUserQuestion` tool** — never output as plain text:
```json
{
  "questions": [{
    "question": "Auto-Split detected {N} logical commits:\n1) feat(auth): add login screen (3 files)\n2) fix(api): handle timeout (1 file)\n3) docs: update README (1 file)\n\nHow to proceed?",
    "header": "Auto-Split Analysis",
    "options": [
      { "label": "Split into {N} commits", "description": "Recommended" },
      { "label": "Single commit", "description": "Combine all changes" },
      { "label": "Custom grouping", "description": "I'll specify groups" }
    ]
  }]
}
```

See `references/auto-split-logic.md` for the full decision tree and examples.

### Step 4: Diff Summary

Show user a clear summary of what will be committed:
- Files changed (added / modified / deleted)
- Lines added / removed
- Test results (if available from recent test run)
- Review verdict (if available from recent review)

Read from:
- `git diff --stat HEAD` for file summary
- `bk/dev/shared/reports/code-review-{feature}.json` and/or `code-review-gemini-{feature}.json` (if exists; ignore a report whose verdict is `error` — the harness failed, it is not a review result)
- `bk/dev/shared/reports/unit-test-{platform}-{feature}.json` (if exists)

### Step 5: Commit Approval Gate (Required)

**Use `AskUserQuestion` tool** — never auto-commit or output as plain text:
```json
{
  "questions": [{
    "question": "Files: N files (+X -Y lines)\nReview: [PASS|WARN|SKIP]\nTests: [PASS|FAIL|SKIP]\n\nCommit message: {proposed_message}",
    "header": "Commit Approval",
    "options": [
      { "label": "Commit with this message" },
      { "label": "Edit commit message", "description": "I'll provide a new message" },
      { "label": "Cancel" }
    ]
  }]
}
```

**Never auto-commit** — always wait for explicit user approval.
If user chose split in Step 3, present each commit group for sequential approval.

### Step 6: Dispatch bk-git-manager

On user approval, dispatch bk-git-manager (haiku):
```
Task(subagent_type: "bk-git-manager", prompt: "
  Task: Stage files and create the commit
  Commit message: {approved_message}
  Files to stage: {file_list or 'all changed'} + any new (??) file of this change (git add skips them)
  Branch: {current_branch}
  Conventional commit type: feat|fix|refactor|test|docs|chore
  Output: commit SHA (report back to conductor)
")
```

If split was chosen: dispatch bk-git-manager once per commit group, staging only the relevant files each time.
bk-git-manager stages files, creates commit with conventional commit format, and returns commit SHA.

### Step 7: Optional PR Creation

After successful commit, **use `AskUserQuestion` tool**:
```json
{
  "questions": [{
    "question": "Commit successful. Create a pull request?",
    "header": "PR Creation",
    "options": [
      { "label": "Yes" },
      { "label": "No" },
      { "label": "Later" }
    ]
  }]
}
```

If Yes:
```bash
gh pr create --title "{feature title}" --body "{summary from the impl reports' ## Summary sections, or the review report}"
```

Return PR URL to user.

## Constraints

- Commit gate is MANDATORY — never skip user approval
- Security check is hook-enforced — cannot be bypassed
- Never commit `.env`, secrets, credentials, or private keys
- bk-git-manager runs haiku (lightweight commit operation)
- Conventional commit format required: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`
- No attribution trailers (`Co-authored-by:`, `Generated with …`, session links) unless the user asked for one — the approved message is committed as-is

## References

- Approval rules: `.claude/rules/approval-rules.md`
- Security rules: `.claude/rules/agent-protocols/tool-restriction.md`
- Agent contract: `Skill("bk-agent-contract")`
- Secret scan patterns: `references/secret-scan-patterns.md`
- Auto-split logic: `references/auto-split-logic.md`
