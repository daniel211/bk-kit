# API Contract

Endpoint summary, models, auth, error handling from OpenAPI.

## Endpoint Inventory

From OpenAPI `api.json` endpoints[]:

```markdown
| Method | Path | Auth | Purpose | Related UC |
|--------|------|------|---------|------------|
| POST | /auth/register | No | User registration | UC-001 |
| POST | /auth/login | No | User login | UC-002 |
| GET | /products | Yes | List products | UC-004 |
| GET | /products/:id | Yes | Product detail | UC-006 |
```

Group by domain/tag from OpenAPI tags[].

## Data Models

From OpenAPI `api.json` models[]:

```markdown
### User
| Field | Type | Required | Validation |
|-------|------|----------|------------|
| id | string (UUID) | Yes | Auto-generated |
| email | string (email) | Yes | Valid email format |
| name | string | Yes | 2-100 chars |
| avatar | string (URL) | No | Valid URL |

### Product
| Field | Type | Required | Validation |
|-------|------|----------|------------|
```

Note relationships: `User hasMany Order`, `Order hasMany Product`.

## Authentication Contract

From OpenAPI security schemes + interview constraints:
- Auth method: Bearer JWT / OAuth2 / API Key
- Token refresh flow
- Session management (expiry, refresh)

## Error Handling Contract

Standard error response format:
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable message",
    "details": [{ "field": "email", "issue": "invalid format" }]
  }
}
```

Common error codes to handle:
| Code | HTTP | Meaning | Client Action |
|------|------|---------|---------------|
| UNAUTHORIZED | 401 | Invalid/expired token | Redirect to login |
| FORBIDDEN | 403 | No permission | Show error message |
| NOT_FOUND | 404 | Resource missing | Show empty state |
| VALIDATION_ERROR | 422 | Invalid input | Show field errors |
| RATE_LIMITED | 429 | Too many requests | Retry with backoff |

## Pagination Contract

If detected from OpenAPI parameters:
- Strategy: cursor-based / offset-limit / page-number
- Default page size
- Sort options

Skip entire section if no OpenAPI input — note: "API contract pending spec input."
