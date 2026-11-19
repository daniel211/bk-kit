---
name: bk-codex-review
description: "Cross-model AI code review powered by the OpenAI Codex CLI (codex exec, read-only sandbox). Optional engine — /bk-review --engine codex."
user-invocable: true
argument-hint: "[feature or files] [--model <codex-model-id>] [--files a,b]"
---

# Codex Review: $ARGUMENTS

Independent, cross-model code review running OpenAI models through the **Codex CLI**
(`codex exec`). Claude writes the code, Codex reviews it. Optional engine: Gemini
(`/bk-gemini-review`) stays the `/bk-review` default; Codex runs via `/bk-review --engine codex`
or `--engine all`.

<Use_When>
- User wants a Codex / OpenAI second opinion on changes before committing
- User invokes `/bk-codex-review [feature or files]`
- During `/bk-review --engine codex` or `--engine all`
</Use_When>

<Do_Not_Use_When>
- Default review — use `/bk-review` (Gemini)
- Running tests — `/bk-test`; debugging a trace — `/bk-debug`
- `codex` CLI not installed or not logged in (use `/bk-review` or `--engine claude`)
</Do_Not_Use_When>

## Approval Gates

Per `.claude/rules/approval-rules.md`: review is No-risk — auto-approve, no gate needed.

## Execution

1. **Validate prerequisites** — `command -v codex` and `codex login status`. Missing →
   `references/cli-setup.md` (`npm i -g @openai/codex`, then `codex login`).

2. **Run the review** —
   `node {skill_dir}/scripts/codex-review.mjs --feature "{feature}" --platform "{platform}" $ARGUMENTS`.
   Flags (`--model`, `--files`): `references/cli-setup.md`.

3. **Present findings** — the script writes
   `bk/dev/shared/reports/code-review-codex-{feature}.json` and `.md`. Summarize: **verdict**
   (`APPROVE` / `REQUEST_CHANGES` / `ERROR`), a severity table (critical / major / minor / info),
   and a concrete suggestion for each blocker or major violation.

**`ERROR` is never a review result.** A non-zero exit means the harness failed (CLI missing or
not logged in, quota, network, unparseable response). Report the tooling failure with the
remediation from the report's `### Harness Error` section — never as findings, never as approval.

## Constraints

- Read-only: the runner uses `codex exec --sandbox read-only`. NEVER pass
  `--dangerously-bypass-approvals-and-sandbox` or `--full-auto`, and never edit source code.
- Calibrated severities: Critical = crashes, leaks, security. Major = architecture violations.
- Markdown reports MUST have a `## ` header and a `<!-- metadata: ... -->` footer.

## References

- Prompt template: `references/review-prompt-template.md`
- Output schema (strict, for `--output-schema`): `references/output-schema.json`
- CLI setup + runner flags: `references/cli-setup.md`
- Runner: `scripts/codex-review.mjs` (scope: `codex-review-scope.mjs`, report: `codex-review-report.mjs`)
