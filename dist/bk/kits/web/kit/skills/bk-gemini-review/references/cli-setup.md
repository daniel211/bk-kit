# Antigravity CLI (`agy`) Setup — bk-gemini-review

The skill keeps the `gemini` name because that is the model doing the reviewing; `agy` is the CLI
that replaced the retired `gemini` CLI in kit 0.2.0.

## Availability check

```bash
command -v agy      # "where agy" on Windows
```

## Install (macOS, Linux and Windows)

- macOS: `brew install --cask antigravity-cli`
- Linux / Windows: `curl -fsSL https://antigravity.google/cli/install.sh | bash`

Then run `agy` once interactively to authenticate. The retired `gemini` CLI is no longer used.

## Runner options

```bash
node {skill_dir}/scripts/gemini-review.mjs \
  --feature "{feature_name}" \
  --platform "{platform}" \
  $ARGUMENTS
```

- `--model <name>` — defaults to `gemini-3.1-pro-high`; `--fast` selects `gemini-3.8-flash-high`.
  Override via `AGY_MODEL`. Run `agy models` to list what the account can reach. Claude models are
  refused — the point is cross-model review.
- `--fast` — fast scan using `gemini-2.5-flash`.
- `--files <file1,file2>` — review exact files instead of the git diff.

## Harness errors

If the script exits non-zero the verdict is `ERROR`: the CLI is not authenticated, the network is
down, or Gemini returned an unparseable response. That is a tooling failure, NOT a review result —
report it with the remediation from the report's `### Harness Error` section, never as findings and
never as an approval. When parsing was the cause, the raw response is saved to
`code-review-gemini-{feature}.raw.txt`.
