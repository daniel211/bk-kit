---
name: bk-review
description: "Hook-guarded review workflow — dispatch bk-code-reviewer background, optional bk-security-auditor for security-sensitive changes. Output: review report."
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

Dispatch all review agents in ONE message (background, sonnet):

**Always:**
```
Task(subagent_type: "bk-code-reviewer", model: "sonnet", run_in_background: true, prompt: "
  TOOL RESTRICTION: You are a READ-ONLY agent. Do NOT use Edit, Bash, or Task tools.
  Feature: {feature_name}
  Platform: {platform}
  Files to review: {file_list or impl-result path}
  Architecture rules: .claude/rules/{platform}-rules.md
  Output: bk/dev/shared/reports/code-review-{feature}.json
")
```

**Optional — security-sensitive changes:**
```
Task(subagent_type: "bk-security-auditor", model: "sonnet", run_in_background: true, prompt: "
  TOOL RESTRICTION: You are a READ-ONLY agent. Do NOT use Edit, Bash, or Task tools.
  Feature: {feature_name}
  Platform: {platform}
  Files to review: {file_list or impl-result path}
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

- `bk/dev/shared/reports/code-review-{feature}.json`
- `bk/dev/shared/reports/security-{feature}.json` (optional)

## Constraints

- Auto-approve — no user gate required
- Both agents are READ-ONLY — MUST NOT use Edit, Bash, or Task tools
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
