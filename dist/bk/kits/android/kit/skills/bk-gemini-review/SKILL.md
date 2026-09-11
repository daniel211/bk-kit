---
name: bk-gemini-review
description: "Cross-model AI code review powered by Antigravity CLI (agy). Inspects architecture compliance, concurrency safety, security, and error handling."
user-invocable: true
argument-hint: "[feature or files] [--model gemini-3.1-pro-high] [--fast]"
---

# Gemini Review: $ARGUMENTS

Automated, independent code review running Gemini models through Google's **Antigravity CLI**
(`agy`). Provides cross-model verification — Claude writes the code, Gemini reviews it — with
deep reasoning on architecture, concurrency, and security.

The skill keeps the `gemini` name because that is the model doing the reviewing; `agy` is the
CLI that replaced the retired `gemini` CLI in kit 0.2.0.

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

---

## Execution

### Step 1: Validate Prerequisites

Check that `gemini` CLI is available in the environment:

```bash
command -v agy      # "where agy" on Windows
```

If `gemini` is not found:
- Install Antigravity CLI — it runs natively on macOS, Linux and Windows:
  `brew install --cask antigravity-cli` (macOS) or
  `curl -fsSL https://antigravity.google/cli/install.sh | bash`, then run `agy` once to
  authenticate. The retired `gemini` CLI is no longer used.
- Authenticate by running `agy` once interactively

### Step 2: Execute Gemini Review Script

Run the review runner script with target parameters:

```bash
node {skill_dir}/scripts/gemini-review.mjs \
  --feature "{feature_name}" \
  --platform "{platform}" \
  $ARGUMENTS
```

Options:
- `--model <name>`: Defaults to `gemini-3.1-pro-high`; `--fast` selects
  `gemini-3.8-flash-high`. Override via `AGY_MODEL`. Run `agy models` to list what the
  account can reach. Claude models are refused — the point is cross-model review.
- `--fast`: Fast scan using `gemini-2.5-flash`.
- `--files <file1,file2>`: Specify exact files instead of git diff.

### Step 3: Present Findings

The script generates:
- JSON Report: `bk/dev/shared/reports/code-review-gemini-{feature}.json`
- Markdown Report: `bk/dev/shared/reports/code-review-gemini-{feature}.md`

Read the report and summarize:
- **Verdict**: `APPROVE`, `REQUEST_CHANGES`, or `ERROR`
- Summary table of critical / major / minor / info findings
- Concrete suggestions for any blocker or major architecture violations.

**If verdict is `ERROR`** (script exits non-zero): the harness failed — the CLI is not
authenticated, the network is down, or Gemini returned an unparseable response. This is
NOT a review result. Report the tooling failure to the user with the remediation from the
report's `### Harness Error` section; do NOT present it as findings, and do NOT let it
pass as an approval. The raw response is saved to `code-review-gemini-{feature}.raw.txt`
when parsing was the cause.

## Constraints

- Read-only inspection — does NOT modify source code.
- Calibrated severities: Blocker/Critical = crashes, leaks, security. Major = clean architecture violations.
- Output compliance: Markdown reports MUST have `## ` header and `<!-- metadata: ... -->` footer.

## References

- Prompt template: `references/review-prompt-template.md`
- Output schema: `references/output-schema.json`
- Runner script: `scripts/gemini-review.mjs`
