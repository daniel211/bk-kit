# UI/UX Requirements

## Screen Inventory

| # | Screen | Type | Key Components | Related UC |
|---|--------|------|----------------|------------|
{{#each screens}}
| {{@index}} | {{name}} | {{type}} | {{components}} | {{relatedUC}} |
{{/each}}

{{#if navigationFlowDiagram}}
## Navigation Map

{{navigationFlowDiagram}}
{{else}}
## Navigation Map

_Navigation map pending design input._
{{/if}}

## Screen Flows

{{#each flows}}
### {{name}}

{{description}}

**Screens:** {{screens}}
**Trigger:** {{trigger}}
{{/each}}

## Interaction Specs

| Screen | Interaction | Behavior |
|--------|-------------|----------|
{{#each interactions}}
| {{screen}} | {{interaction}} | {{behavior}} |
{{/each}}

## Design Constraints

| Constraint | Value | Source |
|------------|-------|--------|
{{#each designConstraints}}
| {{name}} | {{value}} | {{source}} |
{{/each}}

{{#if platformConsiderations}}
## Platform Considerations

| Platform | Consideration | Impact |
|----------|--------------|--------|
{{#each platformConsiderations}}
| {{platform}} | {{consideration}} | {{impact}} |
{{/each}}
{{/if}}
