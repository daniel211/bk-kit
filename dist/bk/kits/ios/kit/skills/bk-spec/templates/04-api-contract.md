# API Contract

## Base

| Field | Value |
|-------|-------|
| Base URL | {{baseUrl}} |
| Version | {{apiVersion}} |
| Auth | {{authScheme}} |

{{#if entityRelationshipDiagram}}
## Entity Relationships

{{entityRelationshipDiagram}}
{{/if}}

## Endpoints

{{#each endpointGroups}}
### {{tag}}

| Method | Path | Auth | Purpose | Related UC |
|--------|------|------|---------|------------|
{{#each endpoints}}
| {{method}} | {{path}} | {{auth}} | {{purpose}} | {{relatedUC}} |
{{/each}}
{{/each}}

## Models

{{#each models}}
### {{name}}

| Field | Type | Required | Validation |
|-------|------|----------|------------|
{{#each fields}}
| {{name}} | {{type}} | {{required}} | {{validation}} |
{{/each}}
{{/each}}

## Error Handling

| Code | HTTP | Meaning | Client Action |
|------|------|---------|---------------|
{{#each errors}}
| {{code}} | {{http}} | {{meaning}} | {{action}} |
{{/each}}

## Pagination

| Field | Value |
|-------|-------|
| Strategy | {{paginationStrategy}} |
| Default Page Size | {{pageSize}} |

{{#if platformConsiderations}}
## Platform Considerations

| Platform | Consideration | Impact |
|----------|--------------|--------|
{{#each platformConsiderations}}
| {{platform}} | {{consideration}} | {{impact}} |
{{/each}}
{{/if}}
