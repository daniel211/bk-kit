# Design System (detected)

## Colors

| Role | Value | Usage |
|------|-------|-------|
{{#each colors}}
| {{role}} | {{value}} | {{usage}} |
{{/each}}

## Typography

| Level | Font | Size | Weight |
|-------|------|------|--------|
{{#each typography}}
| {{level}} | {{font}} | {{size}} | {{weight}} |
{{/each}}

## Spacing & Layout

| Token | Value | Usage |
|-------|-------|-------|
{{#each spacing}}
| {{token}} | {{value}} | {{usage}} |
{{/each}}

## Component Inventory

| Component | File | Variants | Reused In |
|-----------|------|----------|-----------|
{{#each components}}
| {{name}} | {{file}} | {{variants}} | {{reusedIn}} |
{{/each}}

## Theming

| Theme | File | Description |
|-------|------|-------------|
{{#each themes}}
| {{name}} | {{file}} | {{description}} |
{{/each}}

## Accessibility

| Check | Status | Evidence |
|-------|--------|----------|
{{#each a11y}}
| {{check}} | {{status}} | {{evidence}} |
{{/each}}
