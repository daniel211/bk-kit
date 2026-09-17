# Review Engine Selection & Dispatch (bk-review Step 2)

**Review Engine Selection (Default: Gemini Reviewer)**:
- **Default (Gemini)**: Dispatch `bk-gemini-reviewer`. Preferred whenever Antigravity CLI is
  installed — probe with `command -v agy` (`where agy` on Windows). The reviewer is named
  for the model it uses, not the CLI: `agy` replaced the retired `gemini` CLI in kit 0.2.0.
- **Fallback (Claude)**: If `agy` is not found or `--engine claude` is requested, dispatch
  `bk-code-reviewer` (sonnet). This path needs no external CLI.
- **Dual Mode (`--engine dual`)**: Dispatch BOTH `bk-gemini-reviewer` and `bk-code-reviewer` in parallel for multi-model consensus. They write to distinct report paths (`code-review-gemini-{feature}.md` vs `code-review-{feature}.md`) — never point both at the same file, or the slower agent silently overwrites the other.

**Tool boundaries differ per engine** — `bk-gemini-reviewer` needs `Bash` to invoke the review harness (`agy`); `bk-code-reviewer` does not. Use the exact TOOL RESTRICTION line shown in each dispatch block below; do not copy one engine's restriction onto the other.

Dispatch review agent(s) in ONE message (background):

**Primary Reviewer (Default: bk-gemini-reviewer):**
```
Task(subagent_type: "bk-gemini-reviewer", model: "sonnet", run_in_background: true, prompt: "
  Task: Code review for feature {feature_name}
  Platform: {platform}
  Files: {file_list from impl reports, or git diff}
  TOOL RESTRICTION: You are a READ-ONLY agent for project code. Do NOT use Edit tool. Use Bash strictly to invoke gemini review harness.
  Architecture rules: .claude/rules/{platform}-rules.md
  Model: gemini-3.1-pro-high
  Output: bk/dev/shared/reports/code-review-gemini-{feature}.md (+ .json)
")
```

*(Fallback if `agy` is not available, or when `--engine claude` is requested)*:
```
Task(subagent_type: "bk-code-reviewer", model: "sonnet", run_in_background: true, prompt: "
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
Task(subagent_type: "bk-security-auditor", model: "sonnet", run_in_background: true, prompt: "
  Task: Security audit for feature {feature_name}
  Platform: {platform}
  Files: {file_list from impl reports, or git diff}
  TOOL RESTRICTION: You are a READ-ONLY agent. Do NOT use Edit, Bash, or Task tools.
  Output: bk/dev/shared/reports/security-{feature}.json
")
```
