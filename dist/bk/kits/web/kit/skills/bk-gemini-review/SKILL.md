---
name: bk-gemini-review
description: "Cross-model AI code review powered by Antigravity CLI (agy). Inspects architecture compliance, concurrency safety, security, and error handling."
user-invocable: true
argument-hint: "[feature or files] [--model gemini-3.1-pro-high] [--fast]"
---

# Gemini Review: $ARGUMENTS

Automated, independent code review running Gemini models through Google's **Antigravity CLI**
(`agy`). Cross-model verification — Claude writes the code, Gemini reviews it — with deep
reasoning on architecture, concurrency, and security.

<Use_When>
- User wants an independent, cross-model review of changes before committing
- User invokes `/bk-gemini-review [feature or files]`
- Prioritizing Gemini Pro for deep architecture & concurrency verification
- During `/bk-review` when Gemini is selected as the review engine
</Use_When>

<Do_Not_Use_When>
- Tests execution only — use `/bk-test`
- Debugging a specific error trace — use `/bk-debug`
- When `gemini` CLI is not installed and network is offline
</Do_Not_Use_When>

## Approval Gates

Per `.claude/rules/approval-rules.md`: review is No-risk — auto-approve, no gate needed.

## Execution

1. **Validate prerequisites** — `command -v agy`. Missing → install + authenticate per
   `references/cli-setup.md`, then retry.

2. **Run the review** —
   `node {skill_dir}/scripts/gemini-review.mjs --feature "{feature}" --platform "{platform}" $ARGUMENTS`.
   Flags (`--model`, `--fast`, `--files`): `references/cli-setup.md`.

3. **Present findings** — the script writes
   `bk/dev/shared/reports/code-review-gemini-{feature}.json` and `.md`. Read the report and
   summarize: **verdict** (`APPROVE` / `REQUEST_CHANGES` / `ERROR`), a severity table
   (critical / major / minor / info), and concrete suggestions for each blocker or major
   architecture violation.

**`ERROR` is never a review result.** A non-zero exit means the harness failed (CLI not
authenticated, network down, unparseable response). Report the tooling failure with the remediation
from the report's `### Harness Error` section — do NOT present it as findings, and do NOT let it
pass as an approval. Detail: `references/cli-setup.md` § Harness errors.

## Constraints

- Read-only inspection — does NOT modify source code.
- Calibrated severities: Blocker/Critical = crashes, leaks, security. Major = clean architecture violations.
- Output compliance: Markdown reports MUST have `## ` header and `<!-- metadata: ... -->` footer.

## References

- Prompt template: `references/review-prompt-template.md`
- Output schema: `references/output-schema.json`
- CLI setup + runner flags: `references/cli-setup.md`
- Runner script: `scripts/gemini-review.mjs`
