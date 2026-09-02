# Foundation Synthesis

Merge all scan data into `bk/docs/foundation/*.md` files.

## Input Sources

| Source | Feeds Into |
|--------|-----------|
| structure-scan | overview.md |
| pattern-detection | architecture.md |
| lsp-analysis | architecture.md (enriched) |
| rule-analysis | code-guidelines.md |
| dependency-extraction | dependencies.md |
| build-target-scan | build-targets.md |
| pattern-detection (UI patterns) | design-system.md |
| structure-scan + rule-analysis | project-roadmap.md |
| scout reports | all files (cross-referenced) |

## Write Order

1. `bk/docs/foundation/overview.md` — from `templates/overview.md`
2. `bk/docs/foundation/architecture.md` — from `templates/architecture.md`
3. `bk/docs/foundation/code-guidelines.md` — from `templates/code-guidelines.md`
4. `bk/docs/foundation/dependencies.md` — from `templates/dependencies.md`
5. `bk/docs/foundation/build-targets.md` — from `templates/build-targets.md`
6. `bk/docs/foundation/design-system.md` — from `templates/design-system.md` (skip if non-UI project)
7. `bk/docs/foundation/project-roadmap.md` — from `templates/project-roadmap.md`

## Rules

- Every detected value MUST cite evidence (file path, import count, line number)
- If a field cannot be detected → write "Not detected" (never guess)
- Keep each file under 300 lines
- Use tables for structured data (faster to parse for agents)
- Frontmatter on overview.md only (other files reference it)

## Platform Context Update

After writing docs, update `.platform-context.json`:
- Override template defaults with detected values
- Only write fields that were confirmed by scan
- Keep template defaults for fields not detected

```
Read existing .platform-context.json template
→ Merge with detected:
  commands: from build-target-scan (verified > default)
  conventions: from pattern-detection (detected > template)
  dirs: from structure-scan (actual > assumed)
→ Write updated .platform-context.json
```

## Cross-Link Rule

Every foundation doc MUST link to related docs:

- overview.md → links to architecture.md, dependencies.md
- architecture.md → links to code-guidelines.md (naming), overview.md (structure)
- code-guidelines.md → links to architecture.md (patterns), build-targets.md (lint)
- dependencies.md → links to build-targets.md (SDK versions)
- build-targets.md → links to dependencies.md (package versions)
- design-system.md → links to code-guidelines.md (naming), architecture.md (component layer)
- project-roadmap.md → links to all other docs

Format: `See [Architecture](./architecture.md#pattern-details)` with anchor links.

Each doc should include a `## See Also` section at the bottom with these cross-links.

## Post-Synthesis Report

Show user a concise summary:

```
Bootstrap complete for {app-name} ({platform})
├── bk/docs/foundation/overview.md         — {N} dirs, {LOC} total LOC, {M} modules
├── bk/docs/foundation/architecture.md     — {arch pattern}, {state mgmt}, {DI}
├── bk/docs/foundation/code-guidelines.md  — {naming}, {N} lint rules, {P} patterns
├── bk/docs/foundation/dependencies.md     — {N} core + {M} dev packages
├── bk/docs/foundation/build-targets.md    — {CI platform}, {N} quality gates
├── bk/docs/foundation/design-system.md    — {N} colors, {M} components (if UI)
└── bk/docs/foundation/project-roadmap.md  — {N} TODOs, {M} improvements

Next: /bk-plan {feature description}
```
