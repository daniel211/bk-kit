# Dispatch Labeling

> Every `Task()` chip in the footer MUST name the model it runs on.

## Purpose

Claude Code renders each running subagent as `<agent-type>  <description>`. The host
does not show which model that subagent uses, and no setting adds it. The only writable
field is `description`, so the model label MUST be encoded there — otherwise the user
cannot tell an opus dispatch from a haiku one while a workflow is running.

## Rules

1. Every `Task()` / `Agent()` call MUST pass `description` in the form
   `[<model>] <3-5 word task>`, where `<model>` is one of `opus`, `sonnet`, `haiku`.
2. The `<model>` prefix is the model the dispatch runs on: the `model` argument when the
   call passes one, otherwise the `model:` in the installed agent file
   (`.claude/agents/<agent>.md`). Read that file; never infer the prefix from memory — the
   project may have changed it with `models` in `.claude/.bk.json` (applied by `bk update`).
3. Pass `model` on a call only for a skill-level tier written in the skill's dispatch example
   (see Model Assignment), and omit it when `.claude/.bk.json` has `models.<agent>` for that
   agent. Never pass one that contradicts the installed frontmatter otherwise.
4. The prefix costs one word. Keep the remaining description to 3-5 words; trim the task
   text, never the prefix.
5. Skills MUST NOT be labeled with a model. A skill has no model of its own — it runs on
   whichever session or subagent invoked it. Report a skill's model only as the model of
   its host dispatch.
6. Result summaries reported back to the user MUST name the model per agent when more
   than one model was used in the workflow, e.g. `bk-planner (opus): 4 phases`.

## Model Assignment

The model per agent is set by the agent frontmatter (`model:` / `effort:`), which a project
overrides with `models` in `.claude/.bk.json` (`docs/user-guide.md`, "Agent models"). Skill
dispatch examples carry no `model:` unless the skill runs an agent off its default tier on
purpose: bk-researcher and bk-docs-writer on sonnet (research and spec writing),
bk-unit-test-agent and bk-device-test-agent on sonnet (bk-test, bk-debug, bk-refactor, quality
loop), bk-brainstormer on sonnet (bk-debug), bk-security-auditor on haiku (bk-health scan).
Defaults at install:

| Model | Agents |
|-------|--------|
| opus | bk-planner, bk-brainstormer, bk-{ios,android,flutter}-developer |
| sonnet | bk-code-reviewer, bk-debugger, bk-security-auditor, bk-test-architect, bk-performance-analyzer, bk-code-simplifier, bk-gemini-reviewer, bk-codex-reviewer, design-* |
| haiku | bk-researcher, bk-project-manager, bk-docs-writer, bk-unit-test-agent, bk-device-test-agent (mobile kits only), bk-git-manager |

Built-in agents (`Explore`, `Plan`, `general-purpose`) follow the same labeling rule;
label them with the model actually passed, or with the session default when none is passed.

## Examples

Good:

```
Task(subagent_type="bk-planner",    model="opus",   description="[opus] Draft auth plan")
Task(subagent_type="bk-researcher", model="haiku",  description="[haiku] Survey Keychain APIs")
Task(subagent_type="Explore",       model="sonnet", description="[sonnet] Find CAConfig usages")
```

Renders as:

```
bk-planner      [opus] Draft auth plan
bk-researcher   [haiku] Survey Keychain APIs
Explore         [sonnet] Find CAConfig usages
```

Bad:

- `description="Draft auth plan"` — no model, user cannot see cost tier in the footer.
- `description="[opus] Draft auth plan"` with `model="sonnet"` — label contradicts the
  actual dispatch.
- `description="[opus] bk-plan skill"` — skills carry no model of their own.
- `description="[opus] Draft the authentication implementation plan"` — over 5 words.
