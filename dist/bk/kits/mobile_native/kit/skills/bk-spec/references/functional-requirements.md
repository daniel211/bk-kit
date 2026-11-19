# Functional Requirements

Generate use cases, user stories, and acceptance criteria.

## Grouping Strategy

Group by feature module (detected from Figma screens or codebase features):
```
Feature: Authentication
  UC-001: User Registration
  UC-002: User Login
  UC-003: Password Reset

Feature: Product Catalog
  UC-004: Browse Products
  UC-005: Search Products
  UC-006: View Product Detail
```

## Use Case Format

For each use case:
```markdown
### UC-{NNN}: {Title}

**Priority:** Must | Should | Could | Won't
**Actor:** {user type}
**Precondition:** {state before}
**Flow:**
1. User {action}
2. System {response}
3. ...

**Acceptance Criteria:**
- [ ] AC-1: {testable criterion}
- [ ] AC-2: {testable criterion}

**Related:** Screen: {figma ref} | API: {endpoint ref}
```

## Priority Assignment (MoSCoW)

| Priority | Criteria |
|----------|----------|
| **Must** | Core flow, app unusable without it |
| **Should** | Important but app works without it for MVP |
| **Could** | Nice-to-have, enhance UX |
| **Won't** | Out of scope for this version |

Use interview answers to determine:
- Core flows from business goals → Must
- MVP scope from stakeholder input → Must/Should split
- Special reqs from constraints → assign per context

## Cross-linking

Every use case must reference:
- Related Figma screen (if available): `Screen: LoginScreen`
- Related API endpoint (if available): `API: POST /auth/login`
- Related NFR (if applicable): `NFR: NFR-SEC-001`

These links enable traceability in bk-plan phase files.

## Output

Write to functional-requirements section of SRS.
Group use cases by feature. Include summary table at top:

```markdown
| ID | Feature | Title | Priority | Screen | API |
|----|---------|-------|----------|--------|-----|
| UC-001 | Auth | Registration | Must | RegisterScreen | POST /auth/register |
```
