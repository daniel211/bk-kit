---
name: bk-team
description: "Orchestrate Agent Teams for parallel multi-session mobile development, debugging, and review."
user-invocable: true
argument-hint: "<dev|debug|review> <context> [--devs|--reviewers|--debuggers N]"
---

# bk-team — MK Agent Team Orchestration

Coordinate multiple independent Claude Code sessions for mobile development. Each teammate has own context window, loads MK context, communicates via shared task list and messaging.

**Requires:** Agent Teams enabled. Set `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in settings.json env.

## Usage

```
/bk-team <template> <context> [flags]
```

**Templates:** `dev`, `debug`, `review`

**Flags:**
- `--devs N` — number of dev agents (default: 2)
- `--debuggers N` — number of debug agents (default: 3)
- `--reviewers N` — number of review agents (default: 3)

## Execution Protocol

**Pre-flight (MANDATORY — step 2 of every template):**
1. Step 2 of every template calls `TeamCreate(team_name: "...", ...)`. Do NOT check whether tool exists — just call it.
2. If SUCCEEDS: continue with template.
3. If ERROR or unrecognized: **STOP. Tell user:** "Agent Teams requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in settings.json. Team mode is not available."
4. Do NOT fall back to subagents. `/bk-team` MUST use Agent Teams or abort.
5. All teammate spawns MUST include `team_name` parameter.

When activated, IMMEDIATELY execute the matching template. Do NOT ask for confirmation. Execute tool calls in order.

---

## MK Context Block

Every teammate spawn prompt MUST include this at the end:

```
MK Context:
- Work dir: {project root}
- Platform: {ios|android|flutter}
- Foundation: bk/docs/foundation/
- Platform context: platform-context.json
- Reports: {plan-dir}/reports/ or bk/dev/reports/
- Plans: bk/dev/
- Branch: {current git branch}
- Active plan: {plan-dir or "none"}
- Commits: conventional (feat:, fix:, docs:, refactor:, test:, chore:)
- Refer to teammates by NAME, not agent ID
```

---

## Templates

When activated, IMMEDIATELY execute the matching template in order — full step-by-step syntax in
`references/team-templates.md`.

### `dev <plan-path> [--devs N]`
Parallel platform dev agents with file ownership, plan approval, then a tester.
READ plan → split into N task groups with non-overlapping file ownership → `TeamCreate` →
`TaskCreate` ×(N+1) (tester `addBlockedBy` all dev tasks) → spawn N `bk-{platform}-developer`
teammates (`mode: "plan"`, `plan_mode_required: true`, opus, `name: "dev-{N}"`) → **approve each
plan** via `plan_approval_response`, rejecting any that violates file ownership → monitor
TaskCompleted (TaskList fallback 60s; message a teammate stuck >5 min) → spawn `tester`
(bk-unit-test-agent, sonnet; owns test files only) → mandatory docs-sync eval → shutdown →
`TeamDelete` → report files built, test results, docs impact.

### `debug <issue> [--debuggers N]`
Adversarial hypothesis investigation — the surviving theory wins.
GENERATE N competing, independently testable hypotheses ("If <cause>, then we should see
<evidence>") → `TeamCreate` → `TaskCreate` ×N (each ADVERSARIAL: disprove the others, message
peers, report evidence FOR and AGAINST) → spawn N `bk-debugger` teammates (sonnet) → monitor,
letting them message each other → read all reports, identify the surviving theory → write
`{reports}/debug-{issue-slug}.md` (root cause, evidence chain, disproven hypotheses, recommended
fix) → shutdown → `TeamDelete` → report root cause + confidence.

### `review <scope> [--reviewers N]`
Parallel focused review — one lens per reviewer (security, performance, test coverage; then
architecture, accessibility, platform conventions).
DERIVE N focuses → `TeamCreate` → `TaskCreate` ×N (severity-rated findings only, concrete evidence
— no "seems"/"probably") → spawn N `bk-code-reviewer` teammates (sonnet) → monitor → synthesize
`{reports}/review-{scope-slug}.md` (deduplicated, CRITICAL > IMPORTANT > MODERATE, action items)
→ shutdown → `TeamDelete` → report finding counts + path.

## When to Use Teams vs Subagents

Use teams when: 3+ independent parallel workstreams, competing debug hypotheses, multi-platform simultaneous dev, workers need to discuss/challenge findings.

Use subagents when: single focused task, sequential chains, research-only, tight token budget.

See `references/agent-teams-best-practices.md` for full decision matrix, token budget, and sizing guidance.

## Error Recovery

1. **Check**: `Shift+Up/Down` (in-process) or click pane (split)
2. **Redirect**: `SendMessage` with corrective instructions
3. **Replace**: Shutdown failed teammate, spawn replacement for same task
4. **Reassign**: `TaskUpdate` stuck task to unblock dependents

## Abort Team

```
Shut down all teammates via SendMessage(type: "shutdown_request"). Then call TeamDelete.
```

If unresponsive: close terminal. Clean orphaned configs at `~/.claude/teams/` manually.

## Rules Reference

See `references/team-coordination-rules.md` for teammate behavior rules.
See `references/agent-teams-best-practices.md` for sizing, worktrees, anti-patterns.
