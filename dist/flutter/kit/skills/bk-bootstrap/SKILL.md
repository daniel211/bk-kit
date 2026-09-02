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

## Workflow

1. **Parse & Detect Platform**
   - Parse `$ARGUMENTS` for project path (default: CWD)
   - Detect platform from project signals
   - IF ambiguous → **use `AskUserQuestion` tool** to ask platform selection
   - IF `bk/docs/foundation/overview.md` exists AND no `--refresh` → **use `AskUserQuestion` tool**: overwrite or skip?
   - **Serena Onboarding** (before any scan):
     1. Check if Serena MCP tools are available in session (look for `serena` tools like `check_onboarding_performed`)
     2. IF available → call `check_onboarding_performed()`
     3. IF not onboarded → call `activate_project(project: "{project-root}")` then `onboarding()`
     4. Set `SERENA_AVAILABLE = true`
     5. IF Serena tools not in session → set `SERENA_AVAILABLE = false`, continue with Grep/Glob only
   Load: `references/structure-scan.md`
   Load: `references/serena-integration.md` (availability check section only)

### Mode Detection

| Flag | Mode | Behavior |
|------|------|----------|
| `--fast` | Fast | 1 Explore (code only, skip docs/design scan) + bk-docs-writer |
| (default) | Standard | 1-3 Explore (code + docs + design parallel) + bk-docs-writer |
| `--deep` | Deep | 1-3 Explore + 2 scouts (deep module analysis) + bk-docs-writer |
| `--refresh` | Refresh | Re-scan existing project, same as Standard/Deep based on size |

Auto-detect if no flag:
- Project < 30 files → Fast mode
- Project 30-200 files → Standard mode  
- Project > 200 files → Deep mode

ALL modes dispatch agents — conductor NEVER scans or writes docs inline.

### Step 2: Input Discovery (conductor inline, < 30s)

Quick Glob scan to detect all available inputs:

```
# Code detection
Glob("**/*.{swift,kt,dart,java}") → count source files
Glob("**/*.xcworkspace") OR Glob("**/build.gradle") OR Glob("**/pubspec.yaml") → platform

# Document detection  
Glob("**/*.{md,txt,pdf,docx}") → list doc files (exclude node_modules, .git, Pods)
Look for: BRD, PRD, requirements, specs, planning docs in project root or docs/

# Design detection
Glob("**/design-app/**") OR Glob("**/tokens.json") OR Glob("**/wireframes/**") → design assets
Glob("**/*.figma") → Figma files

# API spec detection
Glob("**/openapi.{yaml,yml,json}") OR Glob("**/swagger.{yaml,yml,json}") → API specs

# Health signals (quick, inline)
Count TODO/FIXME: Grep("TODO|FIXME|HACK", source files) → count
Check lock file age: stat Podfile.lock/Package.resolved → days since modified
```

List findings for user.

### Step 3: Clarify Input (AskUserQuestion if needed)

IF docs or design detected → confirm with user:
```
AskUserQuestion:
  header: "Project Input Discovery"
  question: "Phát hiện trong project:
    - Code: {count} {platform} files
    - Docs: {list doc files found}
    - Design: {design assets found}
    - API specs: {api files found}
    Bạn có thêm tài liệu dự án hoặc mô tả nào không?"
  options:
    - "Tiến hành scan với những gì phát hiện" (Recommended)
    - "Tôi có thêm tài liệu ở folder khác"
    - "Để tôi mô tả dự án cho bạn"
```

IF only code found (no docs/design) → ask briefly:
```
AskUserQuestion:
  question: "Project chỉ có code ({count} files). Bạn có BRD, design specs, hoặc mô tả dự án không?"
  options:
    - "Không, scan code là đủ" (Recommended)
    - "Có, tài liệu ở..."
```

IF input clear (code + docs + design all present) → proceed without asking.

### Step 3b: Create Task Tracking

Create tasks upfront for workflow visibility:

```
T1 = TaskCreate(subject="Scan source code",         activeForm="Scanning source code")
IF docs detected:
  T2 = TaskCreate(subject="Scan project documents",  activeForm="Scanning documents")
IF design detected:
  T3 = TaskCreate(subject="Scan design specs",       activeForm="Scanning design specs")
IF api_specs detected:
  T_api = TaskCreate(subject="Parse API specs", activeForm="Parsing API specs")
T4 = TaskCreate(subject="Synthesize foundation docs",  activeForm="Synthesizing docs",   addBlockedBy=[T1, T2?, T3?])
IF SERENA_AVAILABLE:
  T5 = TaskCreate(subject="Enrich Serena memory",    activeForm="Enriching Serena",      addBlockedBy=[T4])
T6 = TaskCreate(subject="Update platform context",   activeForm="Updating context",      addBlockedBy=[T4])
```

### Step 4: Dispatch Parallel Scan Agents

Dispatch ALL scan agents in **ONE message** (parallel background).
Each agent scans ONE domain. Conductor collects results after all complete.

**Agent 1: Code Scan** (ALWAYS dispatched)
```
TaskUpdate(taskId=T1, status="in_progress")
Task(subagent_type: "Explore", run_in_background: true,
  description: "Scan source code structure", prompt: "
  Scan source code at {project_root}/{source_dir}.

  Tasks:
  1. Directory structure — top-level dirs, file counts, LOC per dir
  2. Entry points — App delegate, main.dart, Application class
  3. Architecture patterns — MVVM/MVC/Clean from class structure, imports
  4. Dependencies — read package manager files (Podfile, Package.swift, build.gradle, pubspec.yaml)
  5. Build configuration — targets, schemes, SDK versions
  6. Code patterns — naming, DI, async, error handling (sample 3-5 files)

  Return structured summary (max 200 lines) with file:line citations.
")
```

**Agent 2: Document Scan** (skip if no docs detected in Step 2)
```
TaskUpdate(taskId=T2, status="in_progress")
Task(subagent_type: "Explore", run_in_background: true,
  description: "Scan project documents", prompt: "
  Read project documentation.
  Files to read: {doc_file_list from Step 2}

  Tasks:
  1. For each doc: summarize purpose, target users, key features, constraints
  2. Extract requirements if BRD/PRD found (functional + non-functional)
  3. Identify stakeholders, user personas, business rules
  4. Note architecture decisions, tech constraints, integration points
  5. IF document appears to be BRD/PRD/URD:
     - Extract features list with priorities (High/Medium/Low)
     - Extract user stories and acceptance criteria
     - Extract stakeholders and user personas
     - Format as structured table:
       ## Extracted Requirements
       | ID | Type | Description | Priority | Source |
  6. IF document is API spec or contains API references:
     - Extract endpoint list: method, path, description
     - Note authentication requirements

  Return structured summary (max 200 lines) with file references.
")
```

**Agent 4: API Spec Scan** (skip if no OpenAPI/Swagger detected in Step 2)
```
TaskUpdate(taskId=T_api, status="in_progress")
Task(subagent_type: "Explore", run_in_background: true,
  description: "Parse API specifications", prompt: "
  Read API spec files: {api_spec_files from Step 2}

  Tasks:
  1. Parse OpenAPI/Swagger → extract endpoints: method, path, description, request/response schemas
  2. Extract authentication methods (Bearer, OAuth, API Key)
  3. Extract data models with field types
  4. Note API versioning strategy

  Return structured summary (max 150 lines) with endpoint table.
")
```

**Agent 3: Design Scan** (skip if no design detected in Step 2)
```
TaskUpdate(taskId=T3, status="in_progress")
Task(subagent_type: "Explore", run_in_background: true,
  description: "Scan design specs", prompt: "
  Read design assets at {design_paths from Step 2}.

  Tasks:
  1. Design tokens — colors (hex), typography (fonts, sizes), spacing values
  2. Component inventory — list all components with variants
  3. Screen inventory — list all screens/flows with navigation
  4. Interaction patterns — transitions, gestures, animations noted

  Return structured summary (max 150 lines) with file references.
")
```

Wait for ALL agents to complete. Mark tasks completed.
Conductor collects agent returns → writes to bk/docs/foundation/_raw/:
- `bk/docs/foundation/_raw/code-scan.md` (from Agent 1)
- `bk/docs/foundation/_raw/docs-scan.md` (from Agent 2, if dispatched)
- `bk/docs/foundation/_raw/design-scan.md` (from Agent 3, if dispatched)
- `bk/docs/foundation/_raw/api-scan.md` (from Agent 4, if dispatched)

Note: Explore agents are read-only — they return data via prompt.
Conductor writes _raw/ files (ALLOWED in anti-self-implementation hook whitelist).

For Deep mode (>200 files), dispatch 2 additional scouts after main scan:
Load: `references/scout-dispatch.md`
Timeout: 3 minutes per scout.

### Step 5: Synthesize Foundation Docs

```
TaskUpdate(taskId=T4, status="in_progress")
```

ALWAYS dispatch bk-docs-writer — DO NOT write bk/docs/foundation/*.md yourself.
```
Task(subagent_type: "bk-docs-writer", model: "haiku",
  description: "Synthesize foundation docs", prompt: "
  Task: Synthesize scan reports into 7 foundation documentation files
  Files: Read scan reports from bk/docs/foundation/_raw/:
    - code-scan.md (source code analysis)
    - docs-scan.md (project documents — if exists)
    - design-scan.md (design specs — if exists)
    - api-scan.md (API specifications — if exists)
    - modules-report.md (deep module scan — if exists)
  User context: {user_description_if_provided}
  Output: Write 7 docs in bk/docs/foundation/:
    1. overview.md — Project identity, purpose (from BRD), structure, tech stack, module map
    2. architecture.md — Patterns, layers, dependency graph, conventions
    3. code-guidelines.md — Naming, patterns, lint rules, error handling
    4. dependencies.md — Packages, versions, internal dep graph
    5. build-targets.md — Commands, CI, quality gates, environments
    6. design-system.md — Colors, typography, spacing, components (from design analysis)
    7. project-roadmap.md — Current state, planned features (from BRD/docs), TODOs
    8. api-contracts.md — API endpoints, models, auth methods (from API analysis)
  Constraints: Include business context from docs. Each file < 300 lines. Evidence-based: cite file + line.
  Template: references/foundation-synthesis.md
")
```

Wait for bk-docs-writer to complete.
```
TaskUpdate(taskId=T4, status="completed")
```

### Step 6: Enrich Serena Memory (if SERENA_AVAILABLE)

After foundation docs are written, update Serena memories with enriched data.
This enables bk-planner and dev agents to read Serena memories for quick context.

```
IF SERENA_AVAILABLE:
  TaskUpdate(taskId=T5, status="in_progress")

  Read key data from foundation docs:
  1. bk/docs/foundation/architecture.md → extract: architecture pattern, layers, state management, DI, navigation
  2. bk/docs/foundation/code-guidelines.md → extract: naming, file organization, error handling, test patterns
  3. bk/docs/foundation/design-system.md → extract: colors, typography, spacing, key components

  serena.write_memory("foundation_architecture", "
    Architecture: {pattern}
    Layers: {layer structure}
    State management: {pattern}
    DI: {pattern}
    Navigation: {pattern}
  ")

  serena.write_memory("foundation_conventions", "
    Naming: {conventions}
    File organization: {pattern}
    Error handling: {pattern}
    Test patterns: {pattern}
  ")

  serena.write_memory("foundation_design_tokens", "
    Colors: {primary, secondary, accent — hex values}
    Typography: {heading, body, caption — font + size}
    Spacing: {scale values}
    Components: {list key components}
  ")

  TaskUpdate(taskId=T5, status="completed")
```

### Step 7: Update Platform Context

Write `.platform-context.json` — enrich from real scan data, not template defaults.
```
TaskUpdate(taskId=T6, status="in_progress")
// Write platform-context.json with detected platform, build commands, SDK versions
TaskUpdate(taskId=T6, status="completed")
```

### Step 8: Report

Show summary to user. Suggest next step:
- If feature has URD/API docs/Figma → `/bk-spec {feature}`
- Otherwise → `/bk-plan {feature}`

### Health Signals

IF TODO/FIXME count > 20 OR lock files > 180 days old:
  Display: "⚠ Project health signals detected: {count} TODO/FIXME items, dependencies {age} days old."
  Suggest: "/bk-health for full project health assessment"

### Suggest Next Steps

Based on scan results:
- IF BRD/requirements extracted → Suggest: "/bk-spec {feature} bk/docs/foundation/_raw/requirements-extract.md — Requirements detected, SRS will use the extract as URD input"
- IF Figma/design detected → Suggest: "/bk-spec {feature} --figma — Design specs available for structured extraction"
- IF API specs detected → Suggest: "/bk-spec {feature} --openapi — API contracts available"
- OTHERWISE → Suggest: "/bk-plan {feature}"

Write extracted requirements to: bk/docs/foundation/_raw/requirements-extract.md (structured)

**Reference files for analysis steps:**

- **Structure Scan** — Load: `references/structure-scan.md`
- **Pattern Detection** — Load: `references/pattern-detection.md` + `references/lsp-analysis.md` + `references/serena-integration.md`
- **Rule Analysis** — Load: `references/rule-analysis.md`
- **Dependency Extraction** — Load: `references/dependency-extraction.md`
- **Build Target Scan** — Load: `references/build-target-scan.md`
- **Scout Dispatch (Deep mode)** — Load: `references/scout-dispatch.md`
- **Foundation Synthesis** — Load: `references/foundation-synthesis.md` + `templates/*.md`

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

Also updates: `.platform-context.json`

## Constraints

- Read-only scan — never build, test, or modify project code
- Only write to `bk/docs/foundation/`, `.platform-context.json`, and `.serena/` (via onboarding)
- Never overwrite existing foundation without user confirmation
- Keep each output file under 300 lines
- Evidence-based: every detected pattern must cite file + line
