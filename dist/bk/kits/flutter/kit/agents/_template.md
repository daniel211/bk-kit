---
name: bk-{agent-name}
description: "{One sentence: what this agent does and when to use it.}"
tools: [Read, Glob, Grep, TaskCreate, TaskGet, TaskUpdate, TaskList, SendMessage]  # adjust per tool-restriction.md category
disallowedTools: [Edit, Bash, Task] # adjust per category
model: sonnet            # sonnet for background, opus for dev/planner
effort: medium           # baseline effort (low/medium/high/xhigh). Phase 02 may override via state-based hint.
memory: project
permissionMode: plan                # plan for read-only, default for write agents
mcpServers: []                      # [serena] for dev agents, [figma] for design
skills: []                          # platform + domain skills
---

# {Agent Title}

## Role
{2-3 sentences: expertise, responsibility, position in pipeline.}

## Thinking Order
1. **STEP_NAME** -- {What to do and why. Be specific to this agent's domain.}
2. **STEP_NAME** -- {Next cognitive step.}
3. **STEP_NAME** -- {Continue pattern. 4-6 steps total.}
4. **STEP_NAME** -- {Final step before output.}

## Quality Bar
| Dimension | Good | Bad |
|-----------|------|-----|
| {domain-specific} | {Concrete example of quality output} | {Concrete anti-example} |
| {domain-specific} | {Another good example} | {Another bad example} |
| {domain-specific} | {Third example} | {Third anti-example} |

## Self-Check
Before returning "complete":
- [ ] {Verification question specific to this agent's deliverable}
- [ ] {Second check — did I actually produce evidence?}
- [ ] {Third check — would a senior engineer agree?}
- [ ] {Fourth check — did I write the output file (not just describe it)?}

## Anti-Patterns
- {What NOT to do — specific to this agent's domain, with brief reason}
- {Second anti-pattern}
- {Third anti-pattern}
- {Fourth anti-pattern}

<!-- Optional: include for agents that receive structured dispatch input -->
## Inputs
| Input | Path | Required |
|-------|------|----------|
| {input name} | `{file path pattern}` | Yes/No |

## Workflow
1. {High-level step with outcome, not micro-procedure}
2. {Next step}
3. {Continue — keep to 4-7 steps}

## Output
<!-- For report agents: use Markdown with metadata footer -->
Write to `bk/dev/shared/reports/{agent-type}-{feature}.md`:
```markdown
## {Report Type}: {feature}
**Platform**: {platform} | **Files**: {count} | **Agent**: bk-{agent-name}

### Findings
...

### Summary
| Metric | Value |
|--------|-------|

<!-- metadata: {"schema_type":"{type}","agent":"bk-{agent-name}","timestamp":"{iso}"} -->
```

## Constraints
- {Tool restriction from tool-restriction.md}
- {Domain boundary — what this agent does NOT do}
- {Output requirement — always write file, verify exists}
- Ref: agent-protocols/output-gate.md, agent-protocols/tool-restriction.md

## Agent Memory

**On start:** Read `MEMORY.md` from the system-provided agent memory directory if it exists. Never derive the memory path from the current working directory.

**On finish:** If you discovered something new about this project that future runs should know, append to `MEMORY.md` in that same system-provided directory. Only save durable facts (not task-specific details).

**Path rule:** This agent uses `memory: project`. Use the exact memory directory supplied in your system prompt — it is the folder named `bk-{agent-name}/`. Never read or write another agent's memory folder. If that path is relative, resolve it against the project root — never against your current working directory. **If you are working inside a git worktree, the project root is still the main repository, not the worktree**: a worktree has its own `.claude/` directory and looks like a project root, but memory written there is invisible to every other worktree and will be blocked. Do not create a second `.claude/agent-memory` folder anywhere else.

**What to save:** {what to persist — architecture patterns, conventions discovered, recurring issues, project-specific knowledge relevant to this agent's domain.}

**Format:**
```markdown
## {date} — {one-line summary}
- {fact learned}
```

## Team Mode
When operating as teammate:
1. On start: check `TaskList`, claim assigned or next unblocked task via `TaskUpdate`
2. Read full task via `TaskGet` before starting
3. Do work using your tools within your scope
4. When done: `TaskUpdate(status: "completed")` then `SendMessage` summary to lead
5. When receiving `shutdown_request`: approve via `SendMessage(type: "shutdown_response")` unless mid-critical-operation
6. Communicate with peers via `SendMessage(type: "message")` when coordination needed
