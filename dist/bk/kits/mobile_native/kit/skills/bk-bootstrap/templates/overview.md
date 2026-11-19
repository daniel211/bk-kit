---
generated: {{timestamp}}
platform: {{platform}}
generator: bk-bootstrap
---

# Project Foundation: {{appName}}

## Identity

| Field | Value |
|-------|-------|
| App Name | {{appName}} |
| Platform | {{platform}} |
| Language | {{language}} {{languageVersion}} |
| Package | {{packageId}} |
| Entry | {{entryPoint}} |
| Min SDK | {{minSdk}} |

## Structure

| Directory | Files | LOC | Purpose |
|-----------|-------|-----|---------|
{{#each directories}}
| {{path}} | {{files}} | {{loc}} | {{purpose}} |
{{/each}}
| **Total** | **{{totalFiles}}** | **{{totalLoc}}** | |

## Gaps / Risks

{{#each gaps}}
- {{this}}
{{/each}}

## Related Docs

- [Architecture](./architecture.md)
- [Code Guidelines](./code-guidelines.md)
- [Dependencies](./dependencies.md)
- [Build Targets](./build-targets.md)
- [Design System](./design-system.md)
- [Project Roadmap](./project-roadmap.md)

## Business Context

| Field | Value |
|-------|-------|
| App Purpose | {{appPurpose}} |
| Target Users | {{targetUsers}} |
| Key Features | {{keyFeatures}} |

## Tech Stack Summary

| Category | Technology | Version | Notes |
|----------|-----------|---------|-------|
{{#each techStack}}
| {{category}} | {{name}} | {{version}} | {{notes}} |
{{/each}}

## Module Map

| Module | Directory | Responsibility | Key Classes | LOC |
|--------|-----------|---------------|-------------|-----|
{{#each modules}}
| {{name}} | {{dir}} | {{responsibility}} | {{keyClasses}} | {{loc}} |
{{/each}}

## Entry Points & App Lifecycle

| Entry | File | Description |
|-------|------|-------------|
{{#each entryPoints}}
| {{name}} | {{file}} | {{description}} |
{{/each}}
