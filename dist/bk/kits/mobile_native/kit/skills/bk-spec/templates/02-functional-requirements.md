# Functional Requirements

## Summary

| Total | Must | Should | Could | Won't |
|-------|------|--------|-------|-------|
| {{total}} | {{must}} | {{should}} | {{could}} | {{wont}} |

## Core Flow Diagrams

{{#each coreFlowDiagrams}}
### {{name}}

{{diagram}}

{{/each}}

## Use Cases

{{#each features}}
### {{name}}

{{#each useCases}}
#### {{id}}: {{title}}

**Priority:** {{priority}}
**Actor:** {{actor}}

**Flow:**
{{#each steps}}
{{@index}}. {{this}}
{{/each}}

**Acceptance Criteria:**
{{#each criteria}}
- [ ] {{id}}: {{description}}
{{/each}}

**Related:** {{#if screen}}Screen: {{screen}}{{/if}} {{#if api}}| API: {{api}}{{/if}}

---
{{/each}}
{{/each}}

{{#if platformConsiderations}}
## Platform Considerations

| Platform | Consideration | Impact |
|----------|--------------|--------|
{{#each platformConsiderations}}
| {{platform}} | {{consideration}} | {{impact}} |
{{/each}}
{{/if}}
