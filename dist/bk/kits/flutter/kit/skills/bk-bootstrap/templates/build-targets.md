# Build Targets

## Commands

| Action | Command | Source |
|--------|---------|--------|
{{#each commands}}
| {{action}} | `{{cmd}}` | {{source}} |
{{/each}}

## CI/CD

| Field | Value |
|-------|-------|
| Platform | {{ciPlatform}} |
| Config | {{ciConfigFile}} |
| Triggers | {{ciTriggers}} |

## Quality Gates

| Gate | Threshold | Source |
|------|-----------|--------|
{{#each qualityGates}}
| {{name}} | {{threshold}} | {{source}} |
{{/each}}

## SDK / Platform Targets

| Target | Version |
|--------|---------|
{{#each sdkTargets}}
| {{name}} | {{version}} |
{{/each}}

## Environment Configuration

| Environment | Config File | Base URL | Notes |
|-------------|------------|----------|-------|
{{#each environments}}
| {{name}} | {{configFile}} | {{baseUrl}} | {{notes}} |
{{/each}}

## Build Variants

| Variant | Description | Signing | Distribution |
|---------|------------|---------|-------------|
{{#each buildVariants}}
| {{name}} | {{description}} | {{signing}} | {{distribution}} |
{{/each}}

## CI Pipeline Detail

| Stage | Step | Tool | Config |
|-------|------|------|--------|
{{#each ciStages}}
| {{stage}} | {{step}} | {{tool}} | {{config}} |
{{/each}}

## Quality Gate Thresholds

| Gate | Metric | Threshold | Current | Status |
|------|--------|-----------|---------|--------|
{{#each qualityGateDetails}}
| {{gate}} | {{metric}} | {{threshold}} | {{current}} | {{status}} |
{{/each}}
