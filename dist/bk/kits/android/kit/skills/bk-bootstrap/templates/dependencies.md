# Dependencies

## Source

| File | Manager |
|------|---------|
| {{depFile}} | {{depManager}} |

## Core Dependencies

| Package | Version | Category | Used In |
|---------|---------|----------|---------|
{{#each coreDeps}}
| {{name}} | {{version}} | {{category}} | {{usedIn}} files |
{{/each}}

## Dev Dependencies

| Package | Version | Category |
|---------|---------|----------|
{{#each devDeps}}
| {{name}} | {{version}} | {{category}} |
{{/each}}

## Risks

{{#each depRisks}}
- {{this}}
{{/each}}

## Dependency Graph

| Package | Depends On | Used By |
|---------|-----------|---------|
{{#each depGraph}}
| {{name}} | {{dependsOn}} | {{usedBy}} |
{{/each}}

## Version Compatibility Matrix

| Package A | Version | Package B | Version | Compatible? |
|-----------|---------|-----------|---------|------------|
{{#each compatibility}}
| {{pkgA}} | {{verA}} | {{pkgB}} | {{verB}} | {{status}} |
{{/each}}

## Update Recommendations

{{#each updateRecs}}
- **{{package}}** {{currentVersion}} → {{recommendedVersion}}: {{reason}}
{{/each}}
