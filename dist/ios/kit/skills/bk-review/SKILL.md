---
name: bk-review
description: "Hook-guarded review workflow — dispatch bk-gemini-reviewer (default) or bk-code-reviewer in background, optional bk-security-auditor for security-sensitive changes. Output: review report."
user-invocable: true
argument-hint: "[feature or files to review]"
---

# Review: $ARGUMENTS

Dispatches bk-code-reviewer (background, sonnet) to inspect code changes. Optionally dispatches bk-security-auditor for security-sensitive changes. Produces structured review report. No code changes — read-only analysis.

<Use_When>
- User wants a code review before committing
- User says "review", "check my code", "audit", "inspect"
- After implementation, as a quality gate
- User invokes `/bk-review [feature or files]`
</Use_When>

<Do_Not_Use_When>
- Tests needed — use /bk-test
- Bug fix — use /bk-debug
- Security audit only — use /bk-review with security flag
</Do_Not_Use_When>

## Approval Gates

Per `.claude/rules/approval-rules.md`: review is No-risk — auto-approve, no gate needed.

---

## Execution

### Step 1: Resolve Scope

Parse `$ARGUMENTS` for feature name, specific files, or "all changed files".
Detect platform per `.claude/rules/core-rules.md` section 1.

### Foundation Context Loading
Before dispatching reviewers:
1. Read `bk/docs/foundation/architecture.md`
2. Pass architecture patterns to bk-code-reviewer dispatch prompt

Check for `impl-result.json` at `bk/dev/shared/{platform}/{feature}-impl-result.json`.
If not found, use `git diff` to identify changed files.

Detect if changes are security-sensitive:
- Auth, login, token, password, encryption, storage, network layer → dispatch bk-security-auditor
- Otherwise → bk-code-reviewer only

### Step 2: Dispatch Review Agents

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
  Files: {file_list or impl-result path}
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
  Files: {file_list or impl-result path}
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
  Files: {file_list or impl-result path}
  TOOL RESTRICTION: You are a READ-ONLY agent. Do NOT use Edit, Bash, or Task tools.
  Output: bk/dev/shared/reports/security-{feature}.json
")
```

### Step 3: Collect and Report

After agents return, read reports and present findings:

**Severity levels:**
- Critical: must fix before commit
- Major: strongly recommended to fix
- Minor: nice to have
- Info: observations only

Show summary table with finding counts by severity.
If critical/major findings: suggest `/bk-debug` or resuming `/bk-code` fix loop.

## Output

- `bk/dev/shared/reports/code-review-{feature}.md` + `.json` (bk-code-reviewer)
- `bk/dev/shared/reports/code-review-gemini-{feature}.md` + `.json` (bk-gemini-reviewer)
- `bk/dev/shared/reports/security-{feature}.md` + `.json` (optional)

A `verdict: "error"` report means the review harness failed (CLI not authenticated,
network down, unparseable response) — it is NOT a code finding. Do not treat it as a
pass or a fail; fix the tooling and re-run.

## Constraints

- Auto-approve — no user gate required
- No reviewer modifies code — Edit and Task are forbidden for ALL review agents
- `bk-code-reviewer` / `bk-security-auditor` are strictly read-only: also NO Bash
- `bk-gemini-reviewer` MAY use Bash, solely to invoke the Gemini review harness
  (`gemini` CLI / `gemini-review.mjs`) — never to modify project files
- Single-message batching: dispatch ALL review agents in ONE message
- Agents write reports only (Write tool) — no code modifications

## References

- Approval rules: `.claude/rules/approval-rules.md`
- Tool restriction (read-only agents): `.claude/rules/agent-protocols/tool-restriction.md`
- Output gate: `.claude/rules/agent-protocols/output-gate.md`
- Agent contract: `Skill("bk-agent-contract")`

## Reactive Orchestration Reminder

This skill operates within the reactive orchestration framework.
After each agent dispatch and return, check output for reactive signals.

**Helper skills available for dispatch at any point in this workflow:**
- **bk-brainstormer** — agent stuck on approach, architecture concern
- **bk-docs-seeker** — unknown API/framework error
- **bk-sequential-thinking** — complex decomposition, conflicting data
- **bk-problem-solving** — creative breakthrough needed, fix loops

**Decision tables:** `rules/reactive-orchestration.md`
**User interaction:** `rules/user-interaction-protocol.md`
