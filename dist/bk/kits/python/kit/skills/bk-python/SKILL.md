---
name: bk-python
description: "Python/FastAPI patterns + pytest/httpx + Alembic. Platform knowledge for bk-python-developer."
user-invocable: false
---

# bk-python Platform Knowledge

Code patterns for Python 3.11+ backends: FastAPI, Pydantic v2, SQLAlchemy 2 async, Alembic,
pytest. **Read the matching reference before writing endpoint, test or migration code** — it
holds the full, copy-paste examples.

## House conventions

- **Layering**: `router.py` (parse, authorize, call service) -> `service.py` (business rules,
  transaction) -> `repository.py` (queries only). Routers never touch the session directly.
- **DI**: `Depends` for session, current user, settings and services; tests swap them with
  `app.dependency_overrides`.
- **Schemas**: Pydantic v2, `extra="forbid"` on input, `Field` constraints for length/format,
  `Decimal` + `gt=0` for amounts; responses via `response_model` (`from_attributes=True`).
- **Access**: every ID lookup filters by owner/tenant; not found and not owned both return 404.
- **Errors**: services raise domain exceptions; one exception handler maps them to the error
  envelope. No `HTTPException` below the router.
- **DB**: `AsyncSession` per request, `selectinload` for relations, bound parameters only.
- **Tests**: pytest-asyncio, `httpx.AsyncClient(transport=ASGITransport(app))`, per-test
  transaction rollback, `respx` for outbound HTTP, factories over fixtures-with-data.
- Django projects: same layering (views -> services -> managers), `pytest-django`.

## References

- Router/service/repository, schemas, DI, async session, errors, settings:
  `references/fastapi-patterns.md`
- Fixtures, async tests, AsyncClient, overrides, factories, respx, rollback:
  `references/pytest-patterns.md`
- Alembic review, expand/contract, downgrade, concurrent indexes: `references/db-migration-checklist.md`
