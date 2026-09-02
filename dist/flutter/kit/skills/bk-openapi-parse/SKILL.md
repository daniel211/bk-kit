---
name: bk-openapi-parse
description: "Parse OpenAPI/Swagger specs into API models and endpoints"
user-invocable: true
argument-hint: "[openapi spec file path or URL]"
---

# Parse OpenAPI Spec: $ARGUMENTS

Parses OpenAPI 3.0/Swagger 2.0 specs into structured API models and endpoints.
Runs inline — reads spec and extracts structured data directly.

<Use_When>
- User provides an OpenAPI/Swagger spec file
- User says "parse api", "extract endpoints", "read swagger"
- API input needed for code generation pipeline
</Use_When>

<Do_Not_Use_When>
- No spec file provided
- User wants Figma extraction — use /bk-spec --design
- Spec is GraphQL (not supported in v1)
</Do_Not_Use_When>

## Workflow

### 1. Locate Spec
- If path: read file directly
- If URL: download via `curl -sL {url} -o /tmp/openapi-spec.json`
- Detect format: JSON or YAML
- Detect version: OpenAPI 3.x or Swagger 2.0

### 2. Parse Spec (Inline)
If `src/scripts/openapi-transformer.ts` exists, use it:
```bash
npx tsx src/scripts/openapi-transformer.ts --input {specPath} --output mk/dev/shared/api-output.json
```

Otherwise, parse inline — extract:
- **Models/Schemas**: name, properties, types, required fields, relationships
- **Endpoints**: method, path, parameters, request/response bodies, auth requirements
- **Auth config**: security schemes (Bearer, OAuth2, API key)
- **Base URL**: servers/host info

### 3. Output
Write `mk/dev/shared/api-output.json`:
```json
{
  "schema": "ApiOutput",
  "version": "1.0",
  "specVersion": "openapi-3.0|swagger-2.0",
  "baseUrl": "string",
  "auth": { "type": "bearer|oauth2|apiKey", "details": {} },
  "models": [
    { "name": "string", "properties": [...], "required": [...] }
  ],
  "endpoints": [
    { "method": "GET|POST|...", "path": "/api/...", "summary": "string", "parameters": [...], "requestBody": {}, "response": {}, "authenticated": true }
  ]
}
```

### 4. Report
Summary: "{N} models, {M} endpoints ({K} authenticated)"
Suggest: `/bk-project-intake` to combine with docs and design data.

## Error Handling
- Invalid spec → report parse errors with line numbers
- Unsupported version → warn and attempt best-effort parse
- Missing required fields → warn but continue with partial output
