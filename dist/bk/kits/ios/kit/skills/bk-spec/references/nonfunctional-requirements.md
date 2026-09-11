# Non-Functional Requirements

Performance, security, scalability, accessibility standards.

## Categories

### Performance (NFR-PERF)

| ID | Requirement | Target | Measurement |
|----|-------------|--------|-------------|
| NFR-PERF-001 | App cold start | < 2s | Time to interactive |
| NFR-PERF-002 | API response time | < 500ms (p95) | Server response |
| NFR-PERF-003 | Image loading | < 1s with placeholder | Perceived load |
| NFR-PERF-004 | Offline data access | < 100ms | Local cache read |

Adjust targets based on interview priority.

### Security (NFR-SEC)

| ID | Requirement | Priority |
|----|-------------|----------|
| NFR-SEC-001 | Token-based auth (JWT/OAuth) | Must |
| NFR-SEC-002 | Secure storage for credentials | Must |
| NFR-SEC-003 | Certificate pinning | Should |
| NFR-SEC-004 | Biometric auth | {from interview constraints} |
| NFR-SEC-005 | Data encryption at rest | Should |

Derive from interview auth answer + OpenAPI security schemes.

### Scalability (NFR-SCALE)

Assess from endpoint count + expected user base:
- Pagination required for list endpoints
- Caching strategy for frequently accessed data
- Background sync for offline support

### Accessibility (NFR-A11Y)

| ID | Requirement | Priority |
|----|-------------|----------|
| NFR-A11Y-001 | VoiceOver/TalkBack support | Should |
| NFR-A11Y-002 | Dynamic type / font scaling | Should |
| NFR-A11Y-003 | Color contrast WCAG AA | Should |
| NFR-A11Y-004 | RTL language support | {from interview constraints} |

### Reliability (NFR-REL)

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-REL-001 | Crash-free rate | > 99.5% |
| NFR-REL-002 | Error handling (no blank screens) | Must |
| NFR-REL-003 | Graceful degradation on network loss | Must |

## Priority Source

- Interview business goals determine which NFR category gets "Must" vs "Should"
- Interview constraints affect NFR-PERF-004, NFR-REL-003 (offline)
- Interview constraints affect NFR-SEC-001 through NFR-SEC-004 (auth)
- Foundation architecture.md affects feasibility assessment
