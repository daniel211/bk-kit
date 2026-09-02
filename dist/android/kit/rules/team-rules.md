# MK Team Rules

> Merged from team-coordination-rules.md + agent-communication.md.
> Team coordination applies when operating via `bk-team`. File-based handoffs apply to all workflows.

## IRON LAW: File-Based Handoffs

Agent A WRITES file → Conductor READS file → Conductor dispatches Agent B with file path.

- Agents MUST write output to pre-agreed paths (defined in dispatch prompt `Output:` section)
- Conductor READS output files — does NOT expect data in prompt response
- Next agent receives OUTPUT PATH of previous agent, not content
- Every dispatch prompt MUST include 5 sections: Task, Mode, Files, Output, Constraints
- `Mode:` declares agent intent — `read` (review/audit) or `write` (edit/create). Defaults to agent role if omitted.
- `Files:` MUST list ALL files agent will read or modify — required for parallel-safety locks
- Read-mode agents can share file access; write-mode agents get exclusive locks
- Platform context is auto-injected by delegation-enforcer hook — do NOT duplicate
- Agents: if stuck or low confidence, include `[SIGNAL: stuck]` or `[SIGNAL: confidence_low]` in output for auto-detection

### Standard Output Paths

| Agent | Output Location |
|-------|----------------|
| Explore (scan) | bk/docs/foundation/_raw/scan-report.md |
| bk-researcher | {plan-dir}/research/researcher-{N}-{topic}.md |
| bk-planner | {plan-dir}/plan.md + sub-task-*.md |
| bk-docs-writer (foundation) | bk/docs/foundation/*.md |
| bk-docs-writer (SRS) | {srs-dir}/*.md |
| bk-docs-writer (project docs) | bk/docs/*.md |
| bk-{platform}-developer | Source code files + {plan-dir}/reports/impl-result.json |
| bk-code-reviewer | bk/dev/shared/reports/code-review-{feature}.md |
| bk-unit-test-agent | bk/dev/shared/reports/unit-test-{platform}-{feature}.md |
| bk-debugger | bk/dev/shared/reports/debug-analysis-{feature}.json |
| bk-git-manager | Git commit (no file output) |
| bk-project-manager | plan.md + phase/sub-task files (in-place checkbox updates) |
| bk-spec (conductor) | bk/dev/{feature-slug}/spec-summary.md |

## File Ownership (CRITICAL — bk-team only)

- Each teammate MUST own distinct files — no overlapping edits
- Define ownership via glob patterns in task descriptions:
  - iOS: `ios/Runner/**`, `*.swift`
  - Android: `android/app/**`, `*.kt`
  - Flutter: `lib/**/*.dart`
  - Shared: `test/**`, `bk/docs/**`
- Lead resolves ownership conflicts by restructuring tasks or handling shared files directly
- Review/test agents: read-only on impl files, write only to reports/test files
- Ownership violation detected → STOP and report to lead immediately

## Git Safety (bk-team)

- Use git worktrees for parallel teammates — eliminates merge conflicts
- Never force-push from a teammate session
- Commit frequently with conventional messages; pull before push
- Commit to worktree branch — never directly to main or develop
- Reference `.platform-context.json` for platform-specific build/test commands

## Communication Protocol (bk-team)

- `SendMessage(type: "message")` for peer DMs — always specify recipient by NAME
- `SendMessage(type: "broadcast")` ONLY for critical blocking issues affecting entire team
- Mark tasks `TaskUpdate(completed)` BEFORE sending completion message to lead
- Include actionable findings (what changed, what to verify) — not just "done"
- Plain text messages — no structured JSON status

## Task Claiming (bk-team)

- Claim lowest-ID unblocked task first (earlier tasks provide context for later)
- Set task to `in_progress` before starting
- Check `TaskList` after completing each task for newly unblocked work
- All tasks blocked → notify lead and offer to help unblock

## Plan Approval Flow (bk-team)

1. Research and plan approach (read-only — no file edits)
2. Submit plan via `ExitPlanMode` → triggers approval to lead
3. Wait for `plan_approval_response`
4. Rejected → revise based on feedback, resubmit
5. Approved → proceed with implementation

See `approval-rules.md` for risk-based gates.

## Conflict Resolution (bk-team)

- Two teammates need same file → escalate to lead immediately
- Shared entry points (AppDelegate, MainActivity, main router) → lead handles directly
- Plan rejected twice → lead takes over that task
- Findings conflict between reviewers → lead synthesizes, documents disagreement
- Blocked by teammate's incomplete work → DM them first, escalate if unresponsive

## Shutdown & Idle (bk-team)

- Going idle after sending a message is NORMAL — not an error
- Sending a message to idle teammate wakes them up
- Approve shutdown requests unless mid-critical-operation
- Mark current task completed before approving shutdown
