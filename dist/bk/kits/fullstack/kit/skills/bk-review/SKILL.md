---
name: bk-review
description: "Review local/uncommitted changes via bk-gemini-reviewer (default), bk-codex-reviewer or bk-code-reviewer (+ security auditor). Triggers: review, code review, check my code, audit, inspect."
user-invocable: true
argument-hint: "[feature or files to review] [--engine gemini|codex|claude|dual|all]"
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
- Reviewing a merge request / PR diff — use /bk-review-mr
</Do_Not_Use_When>

**Naming:** this skill is `/bk-review`. `/bk-code-review` does not exist — `bk-code-reviewer`
is the *agent* it dispatches, and `bk-code-review-workflow` is the agent-side skill that agent
loads. Do not invent a `/bk-code-review` command.

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

Collect the feature's impl reports — markdown, one per implementation dispatch
(schema: `bk-agent-contract` §3). There is no `impl-result.json`.

```
Glob bk/dev/{feature}/research/impl-sub-task-*.md      # from /bk-code
Glob bk/dev/shared/reports/impl-{feature}-*.md         # from /bk-debug, /bk-refactor
```

Union their `files_changed` frontmatter → the review surface. If no report matches, fall
back to `git diff --name-only` and say in the report that scope came from the diff, not
from a dev agent's own account of its work.

Detect if changes are security-sensitive:
- Auth, login, token, password, encryption, storage, network layer → dispatch bk-security-auditor
- Otherwise → bk-code-reviewer only

### Step 2: Dispatch Review Agents

**Engine selection** — default `bk-gemini-reviewer` whenever the Antigravity CLI is installed
(probe `command -v agy`; `where agy` on Windows). Fallback `bk-code-reviewer` (sonnet) when `agy`
is missing or `--engine claude` is requested — no external CLI needed. `--engine dual` dispatches
BOTH in parallel for multi-model consensus, writing to **distinct** report paths
(`code-review-gemini-{feature}.md` vs `code-review-{feature}.md`) — never point both at one file
or the slower agent silently overwrites the other.

`--engine codex` dispatches `bk-codex-reviewer` (OpenAI Codex CLI; probe `command -v codex`),
falling back to `bk-code-reviewer` when `codex` is missing. `--engine all` dispatches gemini +
codex + claude in parallel, each to its own report (`code-review-codex-{feature}.md` for Codex);
skip an engine whose CLI is missing and say so. Codex is never the default.

**Tool boundaries differ per engine**: `bk-gemini-reviewer` / `bk-codex-reviewer` need `Bash` to
invoke their review harness (`agy` / `codex`); `bk-code-reviewer` and `bk-security-auditor` get no
Bash at all. Copy the exact
TOOL RESTRICTION line for the engine you are dispatching — never the other one's.

Dispatch all review agents in ONE message (background). Copy-paste prompts for all three agents:
`references/review-dispatch.md`

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
- `bk/dev/shared/reports/code-review-codex-{feature}.md` + `.json` (bk-codex-reviewer)
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
- `bk-codex-reviewer` likewise, solely for `codex` / `codex-review.mjs` (read-only sandbox;
  never `--dangerously-bypass-approvals-and-sandbox` or `--full-auto`)
- Single-message batching: dispatch ALL review agents in ONE message
- Agents write reports only (Write tool) — no code modifications

## References

- Approval rules: `.claude/rules/approval-rules.md`
- Tool restriction (read-only agents): `.claude/rules/agent-protocols/tool-restriction.md`
- Output gate: `.claude/rules/agent-protocols/output-gate.md`
- Agent contract: `Skill("bk-agent-contract")`

## Reactive Orchestration Reminder

After each agent dispatch returns, check its output for reactive signals. Helper skills
dispatchable at any point: **bk-brainstormer** (stuck on approach / architecture concern),
**bk-docs-seeker** (unknown API or framework error), **bk-sequential-thinking** (complex
decomposition, conflicting data), **bk-problem-solving** (fix loops, breakthrough needed).

**Decision tables:** `rules/reactive-orchestration.md` — **User interaction:** `rules/user-interaction-protocol.md`
