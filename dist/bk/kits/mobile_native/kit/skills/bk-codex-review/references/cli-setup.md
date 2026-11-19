# OpenAI Codex CLI (`codex`) Setup — bk-codex-review

## Availability check

```bash
command -v codex        # "where codex" on Windows
codex login status      # exit 0 = logged in (an exported OPENAI_API_KEY also works)
```

## Install

```bash
npm i -g @openai/codex
codex login             # ChatGPT sign-in, or an API key
```

`bk doctor` reports it as an optional check: `codex CLI available (code review, optional)`.

## Runner options

```bash
node {skill_dir}/scripts/codex-review.mjs --feature "{feature}" --platform "{platform}" $ARGUMENTS
```

- `--model <id>` — passed to Codex as `-m <id>`. Omitted → no `-m`, so your own Codex config
  default (`~/.codex/config.toml`) applies. Claude model ids are refused (cross-model review).
- `--files <a,b>` — review exact files instead of the git diff (+ untracked files).
- `CODEX_CLI_PATH` — use this binary instead of the one on PATH.
- `CODEX_REVIEW_TIMEOUT_MS` — kill the run after this long (default 20 min).

The runner invokes, with the prompt on stdin:

```bash
codex exec --sandbox read-only --skip-git-repo-check --json [-m <id>] \
  --output-schema references/output-schema.json -o <tmpfile> -
```

The final message is read from the `-o` file; if that is empty it falls back to the last
`agent_message` in the `--json` event stream, and `error` / `turn.failed` events supply the
failure text. Never add `--dangerously-bypass-approvals-and-sandbox` or `--full-auto`.

## Harness errors

Non-zero exit = verdict `ERROR`: CLI not logged in, quota, network, or an unparseable answer.
That is a tooling failure, NOT a review result — report it with the remediation from the
report's `### Harness Error` section. When parsing was the cause the raw answer is saved to
`code-review-codex-{feature}.raw.txt`.
