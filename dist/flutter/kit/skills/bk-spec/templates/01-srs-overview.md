---
generated: {{timestamp}}
srs_updated: {{timestamp}}
platform: {{platform}}
generator: bk-spec
feature: {{featureSlug}}
scope: {{scope}}
---

# Software Requirements Specification: {{featureName}}

## Project Scope

| Field | Value |
|-------|-------|
| Feature | {{featureName}} |
| Platform | {{platform}} |
| Purpose | {{purpose}} |
| Target Users | {{targetUsers}} |
| Scope | {{scope}} |

## Stakeholders

| Role | Responsibility |
|------|---------------|
{{#each stakeholders}}
| {{role}} | {{responsibility}} |
{{/each}}

## Core Workflows

{{#each coreFlows}}
- {{this}}
{{/each}}

## System Context

{{systemContextDiagram}}

## Priority Focus

{{priorityFocus}}

## Constraints

{{#each constraints}}
- {{this}}
{{/each}}

## Glossary

| Term | Definition |
|------|-----------|
{{#each glossary}}
| {{term}} | {{definition}} |
{{/each}}

{{#if platformConsiderations}}
## Platform Considerations

| Platform | Consideration | Impact |
|----------|--------------|--------|
{{#each platformConsiderations}}
| {{platform}} | {{consideration}} | {{impact}} |
{{/each}}
{{/if}}

## Related Documents

- [Foundation Overview](../../docs/foundation/overview.md)
- [Functional Requirements](./02-functional-requirements.md)
- [Non-Functional Requirements](./03-nonfunctional-requirements.md)
- [API Contract](./04-api-contract.md)
- [UI/UX Requirements](./05-ui-ux-requirements.md)
