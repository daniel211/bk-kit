# Code Guidelines (detected)

## Naming Conventions

| Element | Convention | Example |
|---------|-----------|---------|
| Files | {{fileNaming}} | {{fileExample}} |
| Classes | {{classNaming}} | {{classExample}} |
| Functions | {{funcNaming}} | {{funcExample}} |
| Constants | {{constNaming}} | {{constExample}} |

## Folder Structure

```
{{folderStructure}}
```

## Lint Rules

| Source | File |
|--------|------|
| {{lintTool}} | {{lintConfigFile}} |

### Key Rules

{{#each lintKeyRules}}
- {{this}}
{{/each}}

### Excluded Paths

{{#each lintExcludes}}
- `{{this}}`
{{/each}}

## Code Patterns

| Pattern | Usage | Example File |
|---------|-------|-------------|
{{#each codePatterns}}
| {{name}} | {{count}} files | {{exampleFile}} |
{{/each}}

## Test Conventions

| Convention | Pattern |
|------------|---------|
| File naming | {{testFileNaming}} |
| Structure | {{testStructure}} |
| Mock approach | {{testMockApproach}} |
| Setup | {{testSetup}} |

## Import Organization

| Order | Category | Example |
|-------|----------|---------|
{{#each importOrder}}
| {{order}} | {{category}} | {{example}} |
{{/each}}

## Error Handling Patterns

| Pattern | Usage | Example File |
|---------|-------|-------------|
{{#each errorPatterns}}
| {{name}} | {{usage}} | {{exampleFile}} |
{{/each}}

## Documentation Standards

| Type | Convention | Coverage |
|------|-----------|----------|
{{#each docStandards}}
| {{type}} | {{convention}} | {{coverage}} |
{{/each}}

## Anti-Patterns Detected

{{#each antiPatterns}}
- **{{name}}**: {{description}} — Found in: {{files}}
{{/each}}
