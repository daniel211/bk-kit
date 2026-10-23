---
name: bk-bootstrap
description: "Scan project codebase, detect platform/architecture/patterns, output foundation docs to bk/docs/foundation/."
user-invocable: true
argument-hint: "[project path] [--fast|--deep|--refresh]"
---

# Bootstrap: $ARGUMENTS

Scan project codebase to produce foundation documentation.
Output: `bk/docs/foundation/` (7 focused .md files).

<Use_When>
- First time setting up the bk toolkit in a project
- User says "bootstrap", "setup", "init", "scan project"
- `bk/docs/foundation/overview.md` missing
- User passes `--refresh` to re-scan
</Use_When>

<Do_Not_Use_When>
- Foundation docs exist and are current — use /bk-plan directly
</Do_Not_Use_When>

## CRITICAL ENFORCEMENT

- Step 4 **MUST** dispatch parallel Explore agents (1 per domain) — DO NOT scan inline
- Step 5 **MUST** dispatch bk-docs-writer — DO NOT write bk/docs/foundation/*.md yourself
- If workflow ends with 0 Task() calls → INCOMPLETE

| Step | Agent | Model | Condition |
|------|-------|-------|-----------|
| Step 4 | Explore ×1-4 | default | **MUST** — 1 code (always) + 1 docs (if detected) + 1 design (if detected) + 1 API (if detected) |
| Step 5 | bk-docs-writer | haiku | **MUST** — always |
| Step 6 | Serena write_memory | — | If SERENA_AVAILABLE |

**VALIDATION:** 0 Task() calls → INCOMPLETE. Min: 2 (1 Explore + 1 bk-docs-writer).

## Mode Detection

| Flag | Mode | Behavior |
|------|------|----------|
| `--fast` | Fast | 1 Explore (code only, skip docs/design scan) + bk-docs-writer |
| (default) | Standard | 1-3 Explore (code + docs + design parallel) + bk-docs-writer |
| `--deep` | Deep | 1-3 Explore + 2 scouts (deep module analysis) + bk-docs-writer |
| `--refresh` | Refresh | Re-scan existing project, same as Standard/Deep based on size |

Auto-detect if no flag: < 30 files → Fast, 30-200 → Standard, > 200 → Deep.

ALL modes dispatch agents — the conductor NEVER scans or writes docs inline.

## Workflow

1. **Parse & Detect Platform**
   - Parse `$ARGUMENTS` for project path (default: CWD), detect platform from project signals
   - IF ambiguous → **use `AskUserQuestion`** to ask platform selection
   - IF `bk/docs/foundation/overview.md` exists AND no `--refresh` → **`AskUserQuestion`**: overwrite or skip?
   - **Serena onboarding** before any scan → sets `SERENA_AVAILABLE`
   Load: `references/structure-scan.md` + `references/serena-integration.md` (onboarding section)

2. **Input Discovery** (conductor inline, < 30s) — Glob for code / docs / design / API specs, plus
   health signals (TODO-FIXME count, lock-file age). List findings for the user.
   Load: `references/input-discovery.md`

3. **Clarify Input** — `AskUserQuestion` when docs/design detected or when only code is found;
   skip asking when code + docs + design are all present.
   **3b. Task Tracking** — TaskCreate per scan domain + synthesis + serena + context.
   Load: `references/input-discovery.md`

4. **Dispatch Parallel Scan Agents** — ALL in ONE message, background: code (always), docs,
   design, API spec (each if detected). Wait for all, then write returns to
   `bk/docs/foundation/_raw/{code,docs,design,api}-scan.md`. Deep mode adds 2 scouts.
   Load: `references/scan-dispatch.md` (+ `references/scout-dispatch.md` for Deep)

5. **Synthesize Foundation Docs** — ALWAYS `Task(bk-docs-writer, haiku)` over `_raw/`; never write
   `bk/docs/foundation/*.md` yourself. Each file < 300 lines, evidence-based (cite file + line).
   Load: `references/scan-dispatch.md` § Step 5 + `references/foundation-synthesis.md` + `templates/*.md`

6. **Enrich Serena Memory** (if `SERENA_AVAILABLE`) — write `foundation_architecture`,
   `foundation_conventions`, `foundation_design_tokens` memories from the foundation docs.
   Load: `references/serena-integration.md` § Step 6

7. **Update Platform Context** — write `platform-context.json` from real scan data, never
   template defaults (detected platform, build commands, SDK versions). python / web: also set
   `root` (dir holding the markers), `framework` (+ web `testRunner`) detected there, merge
   `frameworks[framework]`, then `runner` + runner-prefixed commands; keep the `frameworks` map.
   fullstack: do this per entry of `components` (its `root`, framework, runner; `present: false`
   when its markers are gone, `true` when found); never drop `components` or a component's `frameworks`.
   Load: `references/foundation-synthesis.md` § Platform Context Update

8. **Report** — show the summary, then suggest the next step (see below).

## Next-Step Suggestions

- IF BRD/requirements extracted → `/bk-spec {feature} bk/docs/foundation/_raw/requirements-extract.md`
  (requirements detected — SRS uses the extract as URD input)
- IF Figma/design detected → `/bk-spec {feature} --figma`
- IF API specs detected → `/bk-spec {feature} --openapi`
- OTHERWISE → `/bk-plan {feature}`

Write extracted requirements to `bk/docs/foundation/_raw/requirements-extract.md` (structured).

**Health signals:** IF TODO/FIXME count > 20 OR lock files > 180 days old → display
"⚠ Project health signals detected: {count} TODO/FIXME items, dependencies {age} days old."
and suggest `/bk-health` for a full assessment.

**Reference files for analysis steps:**

- **Structure Scan** — `references/structure-scan.md`
- **Pattern Detection** — `references/pattern-detection.md` + `references/lsp-analysis.md` + `references/serena-integration.md`
- **Rule Analysis** — `references/rule-analysis.md`
- **Dependency Extraction** — `references/dependency-extraction.md`
- **Build Target Scan** — `references/build-target-scan.md`
- **Scout Dispatch (Deep mode)** — `references/scout-dispatch.md`
- **Foundation Synthesis** — `references/foundation-synthesis.md` + `templates/*.md`

## Output Contract

```
bk/docs/foundation/
├── overview.md            # Project identity + structure + tech stack + module map
├── architecture.md        # Patterns + layer map + dependency graph + conventions
├── code-guidelines.md     # Naming, patterns, lint rules + error handling + imports
├── dependencies.md        # Packages + versions + dep graph + compatibility
├── build-targets.md       # Commands, CI detail, quality gates + environments
├── design-system.md       # Colors, typography, spacing, components (if UI project)
└── project-roadmap.md     # Current state, TODOs, improvements, migrations
```

Also updates: `platform-context.json`

## Constraints

- Read-only scan — never build, test, or modify project code
- Only write to `bk/docs/foundation/`, `platform-context.json`, and `.serena/` (via onboarding)
- Never overwrite existing foundation without user confirmation
- Keep each output file under 300 lines
- Evidence-based: every detected pattern must cite file + line
