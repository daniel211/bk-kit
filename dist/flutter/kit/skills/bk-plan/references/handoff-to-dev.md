# bk-plan → bk-code Handoff

Contract between planning output and dev execution.

## What bk-code Reads Per Sub-Task

Plan files are named `sub-task-NN-{slug}.md` — `/bk-code` globs `sub-task-*` and will not
see a `phase-*.md` file.

| Section | Purpose | Required |
|---------|---------|----------|
| YAML `depends` | Know when sub-task is unblocked | Yes |
| YAML `platform` | Which platform to generate for | Yes |
| YAML `parallel-with` | Sub-tasks safe to run concurrently | Parallel mode |
| YAML `reqs` | Traceability to requirements | Yes |
| YAML `owns` | File ownership — which files this sub-task may edit | Deep mode |
| `## Scope` | Files to create/modify, LOC estimate | Yes |
| `## Existing Code` | Patterns to follow, files to modify | Yes |
| `## Expected Code` | Implementation spec per platform | Yes |
| `## Tasks` | Checklist — what to implement | Yes |
| `## Success Criteria` | Verify completion | Yes |
| `## Test Plan` | Test cases for the batch test phase | Yes |
| `## Review Checklist` | Checks for the batch review phase | Yes |
| `## Strings` | Localized string resources to generate | UI sub-tasks |
| `## Design Specs` | Screen layout and design tokens | UI sub-tasks |

**Checkbox contract:** `## Tasks` is the only checkbox section. bk-code hydrates Claude
Tasks from `## Tasks` and dev agents tick `## Tasks`. Checkboxes anywhere else are content,
not progress — never hydrate or tick them.

## File Ownership Contract

When sub-task YAML includes `owns` field:
- bk-code MUST only create/modify files matching `owns` patterns
- Before editing any file: check it's within ownership scope
- If a needed file is outside scope: note in output, don't edit
- Shared files not in any `owns`: warn user before touching

When `owns` is absent (fast mode): no ownership enforcement.

## Requirement Traceability

bk-code MUST:
- Reference the trace IDs from sub-task `reqs` YAML verbatim when documenting changes
- Ensure every task maps to at least one requirement
- Report which IDs are fulfilled when the sub-task completes (impl report `requirements_satisfied`)

## bk-code Execution Rules

bk-code MUST:
- Follow Expected Code structure (can improve details, not restructure)
- Use localized string keys from Strings table — never hardcode UI text
- Generate for the platform listed in YAML `platform`
- Follow existing patterns shown in `## Existing Code`
- Update `- [ ]` → `- [x]` in `## Tasks` as tasks complete
- Report deviations from Expected Code in output

bk-code MUST NOT:
- Skip the platform listed in the sub-task
- Ignore Strings table and hardcode text
- Restructure the architecture shown in Expected Code
- Modify files not listed in Existing Code or Expected Code without noting it
- Edit files outside `owns` scope (when ownership is declared)

## Test Sub-Task → Tester Agent

Tester agent reads:
- `## Unit Tests` table → test cases with priority
- `## Integration Tests` table → cross-component tests
- `## Edge Cases` → additional coverage
- Actual implemented code from completed sub-tasks

Tester writes real test code using the descriptions as spec.
P0 tests must pass. P1 tests should pass (warn if skip). Edge cases = best effort.

## Inputs Directory → Dev Agent Context

`inputs/generation-input.json` provides full structured context:
- `design.screens[]` → component tree for UI generation
- `design.tokens` → colors, typography, spacing values
- `api.models[]` → field names, types, relationships
- `api.endpoints[]` → method, path, params, auth requirements
- `requirements[]` → priority, related screens/endpoints

Dev agent reads this alongside sub-task Expected Code for data-driven implementation.

## Resume Protocol

See `handoff-protocol.md` → Resume Protocol for canonical spec.

Summary: read `.plan-state.json` + plan.md → find incomplete sub-tasks → re-hydrate unchecked `## Tasks` items → continue.
