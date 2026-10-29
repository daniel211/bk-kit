# Review Engine Selection & Dispatch (bk-review Step 2)

**Review Engine Selection (Default: Gemini Reviewer)**:
- **Default (Gemini)**: Dispatch `bk-gemini-reviewer`. Preferred whenever Antigravity CLI is
  installed — probe with `command -v agy` (`where agy` on Windows). The reviewer is named
  for the model it uses, not the CLI: `agy` replaced the retired `gemini` CLI in kit 0.2.0.
- **Fallback (Claude)**: If `agy` is not found or `--engine claude` is requested, dispatch
  `bk-code-reviewer` (sonnet). This path needs no external CLI.
- **Codex (`--engine codex`)**: Dispatch `bk-codex-reviewer` (OpenAI Codex CLI). Probe with
  `command -v codex` (`where codex` on Windows); if missing, fall back to `bk-code-reviewer` and
  say so (remedy: `npm i -g @openai/codex`, then `codex login`). Optional engine — never the default.
- **Dual Mode (`--engine dual`)**: Dispatch BOTH `bk-gemini-reviewer` and `bk-code-reviewer` in parallel for multi-model consensus. They write to distinct report paths (`code-review-gemini-{feature}.md` vs `code-review-{feature}.md`) — never point both at the same file, or the slower agent silently overwrites the other.
- **All Mode (`--engine all`)**: Dispatch `bk-gemini-reviewer`, `bk-codex-reviewer` and
  `bk-code-reviewer` in parallel, one message. Distinct reports: `code-review-gemini-{feature}.md`,
  `code-review-codex-{feature}.md`, `code-review-{feature}.md`. Skip (and report) any engine whose
  CLI is missing; the Claude reviewer always runs.

**Tool boundaries differ per engine** — `bk-gemini-reviewer` needs `Bash` to invoke the review harness (`agy`), `bk-codex-reviewer` likewise (`codex`); `bk-code-reviewer` does not. Use the exact TOOL RESTRICTION line shown in each dispatch block below; do not copy one engine's restriction onto the other.

Dispatch review agent(s) in ONE message (background):

**Primary Reviewer (Default: bk-gemini-reviewer):**
```
Task(subagent_type: "bk-gemini-reviewer", run_in_background: true, prompt: "
  Task: Code review for feature {feature_name}
  Platform: {platform}
  Files: {file_list from impl reports, or git diff}
  TOOL RESTRICTION: You are a READ-ONLY agent for project code. Do NOT use Edit tool. Use Bash strictly to invoke gemini review harness.
  Architecture rules: .claude/rules/{platform}-rules.md
  Model: gemini-3.1-pro-high
  Output: bk/dev/shared/reports/code-review-gemini-{feature}.md (+ .json)
")
```

**Codex Reviewer (`--engine codex` / `--engine all`):**
```
Task(subagent_type: "bk-codex-reviewer", run_in_background: true, prompt: "
  Task: Code review for feature {feature_name}
  Platform: {platform}
  Files: {file_list from impl reports, or git diff}
  TOOL RESTRICTION: You are a READ-ONLY agent for project code. Do NOT use Edit tool. Use Bash strictly to invoke the codex review harness (codex-review.mjs). Never pass --dangerously-bypass-approvals-and-sandbox or --full-auto.
  Architecture rules: .claude/rules/{platform}-rules.md
  Model: {--model value if the user gave one; otherwise omit — the user's Codex default applies}
  Output: bk/dev/shared/reports/code-review-codex-{feature}.md (+ .json)
")
```

*(Fallback if `agy` — or, for `--engine codex`, `codex` — is not available, or when `--engine claude` is requested)*:
```
Task(subagent_type: "bk-code-reviewer", run_in_background: true, prompt: "
  Task: Code review for feature {feature_name}
  Platform: {platform}
  Files: {file_list from impl reports, or git diff}
  TOOL RESTRICTION: You are a READ-ONLY agent. Do NOT use Edit, Bash, or Task tools.
  Architecture rules: .claude/rules/{platform}-rules.md
  Output: bk/dev/shared/reports/code-review-{feature}.md (+ .json)
")
```

**Optional — security-sensitive changes:**
```
Task(subagent_type: "bk-security-auditor", run_in_background: true, prompt: "
  Task: Security audit for feature {feature_name}
  Platform: {platform}
  Files: {file_list from impl reports, or git diff}
  TOOL RESTRICTION: You are a READ-ONLY agent. Do NOT use Edit, Bash, or Task tools.
  Output: bk/dev/shared/reports/security-{feature}.json
")
```
