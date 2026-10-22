# Python Platform Rules

## Language & Conventions
- Python 3.11+, PEP 8, formatted by `ruff format`, linted by `ruff check`
- Type hints on every function signature and public attribute; `mypy` clean (no bare `Any`)
- snake_case: files, modules, functions, variables; PascalCase: classes; UPPER_SNAKE: constants
- File named after its primary concern: `user_service.py`, `order_repository.py`
- `Decimal` for money (never `float`); `datetime` always timezone-aware (UTC)
- No mutable default arguments; no bare `except:`; raise domain exceptions, not `HTTPException`, below the router

## Framework Variants
Read `framework` from `.claude/platform-context.json` (missing = `generic`); commands come from its `commands`.

### FastAPI
- Router -> service -> repository; routers only parse, authorize, call a service, map the result
- DI via `Depends` (session, current user, services); never construct dependencies in a handler
- Pydantic v2 schemas for request/response (`model_config = ConfigDict(extra="forbid")` on input)
- Never return ORM objects directly — `response_model` + `from_attributes=True`
- Async all the way: `async def` handlers use async drivers (asyncpg, httpx.AsyncClient); blocking work goes to `run_in_threadpool`
- Settings via `pydantic-settings` from env/vault; one cached `get_settings()`

### Django + DRF
- `<app>/` with models, managers, services, serializers, views, urls; views -> services -> managers/querysets
- `get_queryset()` always filtered by `request.user` / tenant — never `Model.objects.get(pk=pk)` on a client id; object permission as a second layer
- DRF `DEFAULT_PERMISSION_CLASSES` = `IsAuthenticated` (never `AllowAny` globally); serializers list `fields` explicitly, never `"__all__"`; money `DecimalField(min_value=...)`
- Writes in a service under `transaction.atomic()` + `select_for_update()`; side effects in `on_commit`
- Settings from env: `DEBUG=False` default, `SECRET_KEY` without default, explicit `ALLOWED_HOSTS`; CSRF middleware stays on
- `makemigrations --check` in CI; `select_related`/`prefetch_related` on every list

### Generic (Flask, scripts, libs)
- Follow the project's structure; same rules: layered, owner-scoped queries, bound params, settings from env

## Dependencies
- Declared in `pyproject.toml`; lockfile committed (`uv.lock` / `poetry.lock` / pinned `requirements.txt`)
- No unpinned (`*`, `latest`) or open-ended ranges on Tier 3/4 systems
- Prefer stdlib and well-maintained packages; audit with `pip-audit`

## Project Structure
- FastAPI: `app/{main.py, core/, db/, deps.py}` + `app/features/<feature>/{router,schemas,service,repository,models}.py`; `alembic/versions/`
- Django: layout in `references/django-patterns.md`
- `tests/{unit,integration}/` + `conftest.py`

## Commands
Use `commands.*` from platform-context (install, build, test, lint, format, typecheck, migrate, migrationsCheck); single test: `pytest path::test -x`. Security: `bandit -r <src>`, `pip-audit`.
