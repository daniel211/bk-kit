# Team Templates — full execution order (bk-team)

Every template calls `TeamCreate` at step 2 and every teammate spawn carries `team_name` plus the
Beer Kit Context Block from SKILL.md.

## ON `/bk-team dev <plan-path>` [--devs N]:

*Parallel platform-specific dev agents with file ownership, plan approval, then tester.*

IMMEDIATELY execute in order:

1. **READ** plan at `<plan-path>`. Parse into N independent task groups with non-overlapping file ownership boundaries. Detect platform from plan frontmatter or `platform-context.json`.

2. **CALL** `TeamCreate(team_name: "<feature-slug>")`

3. **CALL** `TaskCreate` x (N + 1):
   - Dev tasks: `File ownership: <glob patterns>` — NO overlap. Include: scope, acceptance criteria.
   - Tester task: `addBlockedBy` all dev task IDs.

4. **CALL** `Task` x N to spawn dev teammates:
   - `subagent_type: "bk-{platform}-developer"`, `mode: "plan"`, `plan_mode_required: true`
   - `name: "dev-{N}"` (no `model`: the agent frontmatter decides)
   - Prompt: task description + file ownership + Beer Kit Context Block

5. **REVIEW AND APPROVE** each dev's plan via `plan_approval_response`. Reject if file ownership violated.

6. **MONITOR** via TaskCompleted events:
   - TaskCompleted events notify when each dev task finishes
   - Fallback: Check `TaskList` if no event in 60s
   - If stuck >5 min, message teammate directly

7. **WHEN ALL DEVS DONE**: spawn tester:
   - `Task(subagent_type: "bk-unit-test-agent", model: "sonnet", name: "tester")`
   - Tester reads implementation files, owns test files only, reports pass/fail

8. **DOCS SYNC EVAL** (mandatory):
   ```
   Docs impact: [none|minor|major]
   Action: [no update needed — <reason>] | [updated <file>] | [needs follow-up]
   ```

9. **SHUTDOWN**: `SendMessage(type: "shutdown_request")` to all teammates
10. **CLEANUP**: `TeamDelete`
11. **REPORT**: files built, test results, docs impact.

## ON `/bk-team debug <issue>` [--debuggers N]:

*Adversarial hypothesis investigation — competing theories, peer challenge, surviving theory wins.*

IMMEDIATELY execute in order:

1. **GENERATE** N competing hypotheses from `<issue>` (default N=3):
   - Each independently testable, predicts different observable symptoms
   - Frame as: "If <cause>, then we should see <evidence>"

2. **CALL** `TeamCreate(team_name: "debug-<issue-slug>")`

3. **CALL** `TaskCreate` x N — one per hypothesis:
   - Subject: `Debug: Test hypothesis — <theory>`
   - Description: `Investigate: <theory>. For issue: <issue>. ADVERSARIAL: try to disprove other theories. Message other debuggers to challenge findings. Report evidence FOR and AGAINST. Save to: {reports}/debugger-{N}-{date}-{slug}.md. Mark task completed when done.`

4. **CALL** `Task` x N to spawn debugger teammates:
   - `subagent_type: "bk-debugger"`, `name: "debugger-{N}"`
   - Prompt: task description + Beer Kit Context Block

5. **MONITOR** via TaskCompleted events. Let debuggers message each other — adversarial convergence.
   - Fallback: Check `TaskList` if no events in 60s
   - TeammateIdle indicates debugger awaiting peer input

6. **READ** all debugger reports. Identify surviving theory as root cause.

7. **WRITE** root cause report: `{reports}/debug-{issue-slug}.md`
   Format: Root cause, evidence chain, disproven hypotheses, recommended fix.

8. **SHUTDOWN**: `SendMessage(type: "shutdown_request")` to all teammates
9. **CLEANUP**: `TeamDelete`
10. **REPORT**: Root cause summary, report path, confidence level.

## ON `/bk-team review <scope>` [--reviewers N]:

*Parallel focused code review — each reviewer owns a different lens.*

IMMEDIATELY execute in order:

1. **DERIVE** N review focuses from `<scope>` (default N=3):
   - Focus 1: Security — auth, input validation, data exposure, OWASP Mobile Top 10
   - Focus 2: Performance — memory leaks, ANR risks, render cycles, async patterns
   - Focus 3: Test coverage — gaps, edge cases, error paths, UI test coverage
   - (If N>3, add: architecture, accessibility, platform conventions)

2. **CALL** `TeamCreate(team_name: "review-<scope-slug>")`

3. **CALL** `TaskCreate` x N — one per focus:
   - Subject: `Review: <focus-title>`
   - Description: `Review <scope> for <focus>. Severity-rated findings only. Format: [CRITICAL|IMPORTANT|MODERATE] <finding> — <evidence> — <fix>. No "seems" or "probably" — concrete evidence only. Save to: {reports}/reviewer-{N}-{date}-{slug}.md. Mark task completed when done.`

4. **CALL** `Task` x N to spawn reviewer teammates:
   - `subagent_type: "bk-code-reviewer"`, `name: "reviewer-{N}"`
   - Prompt: task description + Beer Kit Context Block

5. **MONITOR** via TaskCompleted events + TaskList fallback (60s).

6. **SYNTHESIZE** into: `{reports}/review-{scope-slug}.md`
   - Deduplicate findings across reviewers
   - Prioritize: CRITICAL > IMPORTANT > MODERATE
   - Action items list

7. **SHUTDOWN**: `SendMessage(type: "shutdown_request")` to all teammates
8. **CLEANUP**: `TeamDelete`
9. **REPORT**: `Review complete. {X} findings ({Y} critical). Report: {path}.`
