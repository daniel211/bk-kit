# Python Platform Rules

## Language & Conventions
- Python 3.11+, PEP 8, formatted by `ruff format`, linted by `ruff check`
- Type hints on every function signature and public attribute; `mypy` clean (no bare `Any`)
- snake_case: files, modules, functions, variables; PascalCase: classes; UPPER_SNAKE: constants
- File named after its primary concern: `user_service.py`, `order_repository.py`
- `Decimal` for money (never `float`); `datetime` always timezone-aware (UTC)
- No mutable default arguments; no bare `except:`; raise domain exceptions, not `HTTPException`, below the router

## FastAPI Patterns
- Router -> service -> repository; routers only parse, authorize, call a service, map the result
- DI via `Depends` (session, current user, services); never construct dependencies in a handler
- Pydantic v2 schemas for request/response (`model_config = ConfigDict(extra="forbid")` on input)
- Never return ORM objects directly — `response_model` + `from_attributes=True`
- Async all the way: `async def` handlers use async drivers (asyncpg, httpx.AsyncClient); blocking work goes to `run_in_threadpool`
- Settings via `pydantic-settings` from env/vault; one cached `get_settings()`
- Django (if the project uses it): views -> services -> ORM managers, DRF serializers for validation, `select_related`/`prefetch_related`

## Dependencies
- Declared in `pyproject.toml`; lockfile committed (`uv.lock` / `poetry.lock` / pinned `requirements.txt`)
- No unpinned (`*`, `latest`) or open-ended ranges on Tier 3/4 systems
- Prefer stdlib and well-maintained packages; audit with `pip-audit`

## Project Structure
```
app/
├── main.py                 # App factory, routers, middleware
├── core/                   # config.py, security.py, logging.py, errors.py
├── db/                     # session.py, base.py
├── features/
│   └── orders/
│       ├── router.py
│       ├── schemas.py      # Pydantic models
│       ├── service.py      # Business logic
│       ├── repository.py   # SQLAlchemy queries
│       └── models.py       # ORM models
└── deps.py                 # Shared Depends providers
alembic/versions/           # Migrations
tests/
├── unit/
├── integration/
└── conftest.py
```

## Build & Test Commands
- Install: `uv sync` (or `pip install -e ".[dev]"`)
- Compile check: `python -m compileall -q app`
- Test: `pytest --cov` (single: `pytest tests/unit/test_x.py -x`)
- Lint: `ruff check .` — Format: `ruff format .` — Types: `mypy .`
- Migrate: `alembic upgrade head`; new: `alembic revision --autogenerate -m "msg"`
- Security: `bandit -r app`, `pip-audit`
