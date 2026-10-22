# Architecture

## Detected Patterns

| Aspect | Detected | Evidence |
|--------|----------|----------|
| Architecture | {{architecture.value}} | {{architecture.evidence}} |
| State Management | {{stateManagement.value}} | {{stateManagement.evidence}} |
| DI | {{di.value}} | {{di.evidence}} |
| Navigation | {{navigation.value}} | {{navigation.evidence}} |
| Networking | {{networking.value}} | {{networking.evidence}} |
| Serialization | {{serialization.value}} | {{serialization.evidence}} |
| Error Handling | {{errorHandling.value}} | {{errorHandling.evidence}} |

## Layer Map

| Layer | Directory | Responsibility |
|-------|-----------|---------------|
{{#each layers}}
| {{name}} | {{dir}} | {{responsibility}} |
{{/each}}

## Data Flow

```
{{dataFlow}}
```

## Key Files

| File | Role |
|------|------|
{{#each keyFiles}}
| {{path}} | {{role}} |
{{/each}}

## Dependency Graph (Layer-to-Layer)

```
{{dependencyGraph}}
```

## Pattern Details

### {{architecture.value}}
{{architecture.detail}}

**Example Flow:**
```
{{architecture.exampleFlow}}
```

### State Management: {{stateManagement.value}}
{{stateManagement.detail}}

**Pattern:**
```
{{stateManagement.codePattern}}
```

### Navigation: {{navigation.value}}
{{navigation.detail}}

## Conventions Detected

| Convention | Pattern | Example | File Count |
|-----------|---------|---------|------------|
{{#each conventions}}
| {{name}} | {{pattern}} | {{example}} | {{count}} |
{{/each}}

## Architecture Risks

{{#each architectureRisks}}
- **{{severity}}**: {{description}} — Evidence: {{evidence}}
{{/each}}
