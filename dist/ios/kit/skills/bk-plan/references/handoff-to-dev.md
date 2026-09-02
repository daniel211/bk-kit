# bk-plan → bk-code Handoff

Contract between planning output and dev execution.

## What bk-code Reads Per Phase

| Section | Purpose | Required |
|---------|---------|----------|
| YAML `depends` | Know when phase is unblocked | Yes |
| YAML `platforms` | Which platforms to generate for | Yes |
| YAML `reqs` | Traceability to requirements | Yes |
| YAML `owns` | File ownership — which files this phase may edit | Deep mode |
| `## Existing Code` | Patterns to follow, files to modify | Yes |
| `## Expected Code` | Implementation spec per platform | Yes |
| `## Strings` | Localized string resources to generate | UI phases |
| `## Input (from Figma)` | Screen layout and design tokens | UI phases |
| `## Tasks` | Checklist — what to implement | Yes |
| `## Done When` | Verify completion | Yes |

## File Ownership Contract

When phase YAML includes `owns` field:
- bk-code MUST only create/modify files matching `owns` patterns
- Before editing any file: check it's within ownership scope
- If a needed file is outside scope: note in output, don't edit
- Shared files not in any `owns`: warn user before touching

When `owns` is absent (fast mode): no ownership enforcement.

## Requirement Traceability

bk-code MUST:
- Reference REQ-IDs from phase `reqs` YAML when documenting changes
- Ensure every task maps to at least one requirement
- Report which REQ-IDs are fulfilled when phase completes

## bk-code Execution Rules

bk-code MUST:
- Follow Expected Code structure (can improve details, not restructure)
- Use localized string keys from Strings table — never hardcode UI text
- Generate for ALL platforms listed in YAML `platforms`
- Follow existing patterns shown in `## Existing Code`
- Update `- [ ]` → `- [x]` as tasks complete
- Report deviations from Expected Code in output

bk-code MUST NOT:
- Skip platforms listed in the phase
- Ignore Strings table and hardcode text
- Restructure the architecture shown in Expected Code
- Modify files not listed in Existing Code or Expected Code without noting it
- Edit files outside `owns` scope (when ownership is declared)

## Test Phase → Tester Agent

Tester agent reads:
- `## Unit Tests` table → test cases with priority
- `## Integration Tests` table → cross-component tests
- `## Edge Cases` → additional coverage
- Actual implemented code from completed phases

Tester writes real test code using the descriptions as spec.
P0 tests must pass. P1 tests should pass (warn if skip). Edge cases = best effort.

## Inputs Directory → Dev Agent Context

`inputs/generation-input.json` provides full structured context:
- `design.screens[]` → component tree for UI generation
- `design.tokens` → colors, typography, spacing values
- `api.models[]` → field names, types, relationships
- `api.endpoints[]` → method, path, params, auth requirements
- `requirements[]` → priority, related screens/endpoints

Dev agent reads this alongside phase Expected Code for data-driven implementation.

## Resume Protocol

See `handoff-protocol.md` → Resume Protocol for canonical spec.

Summary: read `.plan-state.json` + plan.md → find incomplete phases → re-hydrate unchecked `[ ]` → continue.
