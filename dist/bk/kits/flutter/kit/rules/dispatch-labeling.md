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
2. The conductor MUST pass `model` explicitly on the dispatch call and use that exact
   value as the prefix. Never infer the prefix from the agent's `model:` frontmatter —
   frontmatter is a default that a call-site `model` argument or a session-wide default
   subagent model can override, so an inferred label can be wrong.
3. When no `model` argument is passed, the prefix MUST be the agent's frontmatter model,
   and the conductor MUST NOT pass a `model` argument that contradicts it.
4. The prefix costs one word. Keep the remaining description to 3-5 words; trim the task
   text, never the prefix.
5. Skills MUST NOT be labeled with a model. A skill has no model of its own — it runs on
   whichever session or subagent invoked it. Report a skill's model only as the model of
   its host dispatch.
6. Result summaries reported back to the user MUST name the model per agent when more
   than one model was used in the workflow, e.g. `bk-planner (opus): 4 phases`.

## Model Assignment

The model per agent is fixed by `conductor-role.md` §2. Do not vary it per call without
a stated reason.

| Model | Agents |
|-------|--------|
| opus | bk-planner, bk-brainstormer, bk-{ios,android,flutter}-developer |
| sonnet | bk-code-reviewer, bk-debugger, bk-security-auditor, bk-test-architect, bk-performance-analyzer, bk-code-simplifier, bk-gemini-reviewer, design-* |
| haiku | bk-researcher, bk-project-manager, bk-docs-writer, bk-unit-test-agent, bk-device-test-agent, bk-git-manager |

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
