# Scan Agent Dispatch (bk-bootstrap Steps 4–5)

## Step 4: Dispatch Parallel Scan Agents

Dispatch ALL scan agents in **ONE message** (parallel, background). Each agent scans ONE domain.
The conductor collects results after all complete.

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

Wait for ALL agents to complete. Mark tasks completed.
The conductor collects agent returns → writes to `bk/docs/foundation/_raw/`:
- `code-scan.md` (Agent 1)
- `docs-scan.md` (Agent 2, if dispatched)
- `design-scan.md` (Agent 3, if dispatched)
- `api-scan.md` (Agent 4, if dispatched)

Note: Explore agents are read-only — they return data via prompt. The conductor writes the `_raw/`
files (ALLOWED in the anti-self-implementation hook whitelist).

For Deep mode (>200 files), dispatch 2 additional scouts after the main scan:
Load `references/scout-dispatch.md`. Timeout: 3 minutes per scout.

## Step 5: Synthesize Foundation Docs

ALWAYS dispatch bk-docs-writer — DO NOT write `bk/docs/foundation/*.md` yourself.

```
TaskUpdate(taskId=T4, status="in_progress")
Task(subagent_type: "bk-docs-writer",
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
TaskUpdate(taskId=T4, status="completed")
```

Wait for bk-docs-writer to complete before Step 6.
