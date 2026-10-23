# pytest Quick Reference

## Test Types
| Type | Location | Command |
|---|---|---|
| Unit (services, pure logic) | `tests/unit/` | `pytest tests/unit` |
| Integration (repository + real DB) | `tests/integration/` | `pytest tests/integration` |
| API (app in-process via httpx) | `tests/api/` | `pytest tests/api` |
| All + coverage | — | `pytest --cov=app --cov-report=term-missing` |

Useful flags: `-x` stop at first failure, `-k name` filter, `--lf` last failed, `-vv`, `--pdb`.

## Config (pyproject.toml)
```toml
[tool.pytest.ini_options]
asyncio_mode = "auto"              # pytest-asyncio: no @pytest.mark.asyncio needed
testpaths = ["tests"]
addopts = "-ra --strict-markers"

[tool.coverage.run]
source = ["app"]
branch = true
```

## Unit Test (service with mocked repositories)
```python
from decimal import Decimal
from uuid import uuid4
import pytest

async def test_create_rejects_insufficient_funds(mocker):
    accounts = mocker.AsyncMock(spec=AccountRepository)
    transfers = mocker.AsyncMock(spec=TransferRepository)
    transfers.get_by_idempotency_key.return_value = None
    accounts.get_owned.return_value = make_account(balance=Decimal("10.00"))
    service = TransferService(FakeSession(), accounts, transfers)

    with pytest.raises(BusinessRuleError) as exc:
        await service.create(uuid4(), make_transfer_in(amount=Decimal("50.00")), "key-12345")

    assert exc.value.code == "insufficient_funds"
    transfers.add.assert_not_awaited()
```
`FakeSession` provides an async-context-manager `begin()`; prefer fakes over deep mock chains.

## Parametrize (validation edges)
```python
@pytest.mark.parametrize("amount", ["0", "-1", "-0.01", "1e20", "abc"])
async def test_transfer_rejects_invalid_amount(client, auth_headers, amount):
    resp = await client.post("/api/v1/transfers", headers=auth_headers,
                             json={"from_account_id": str(uuid4()),
                                   "to_account_id": str(uuid4()), "amount": amount})
    assert resp.status_code == 422
```

## conftest.py — DB with per-test rollback
```python
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

@pytest.fixture(scope="session")
def database_url() -> str:
    # testcontainers: with PostgresContainer("postgres:16") as pg: yield pg.get_connection_url()
    return os.environ["TEST_DATABASE_URL"]       # never the prod/staging URL

@pytest.fixture(scope="session")
async def engine(database_url):
    engine = create_async_engine(database_url)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)   # or run `alembic upgrade head`
    yield engine
    await engine.dispose()

@pytest.fixture
async def session(engine) -> AsyncIterator[AsyncSession]:
    async with engine.connect() as conn:
        trans = await conn.begin()
        maker = async_sessionmaker(bind=conn, expire_on_commit=False,
                                   join_transaction_mode="create_savepoint")
        async with maker() as s:
            yield s                                # service commits hit a SAVEPOINT
        await trans.rollback()                     # nothing survives the test
```
Session-scoped async fixtures need `asyncio_default_fixture_loop_scope = "session"`
(pytest-asyncio >= 0.24) or a session-scoped `event_loop` policy.

## API Client + Dependency Overrides
```python
import httpx
from httpx import ASGITransport

@pytest.fixture
def user() -> User:
    return User(id=uuid4(), roles=["customer"])

@pytest.fixture
async def client(session, user) -> AsyncIterator[httpx.AsyncClient]:
    app = create_app()
    app.dependency_overrides[get_session] = lambda: session
    app.dependency_overrides[get_current_user] = lambda: user
    async with httpx.AsyncClient(transport=ASGITransport(app=app),
                                 base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()
```
Override `get_current_user` for most tests, but keep at least one test that sends a real
(test-signed) token through `verify_access_token` — expired, wrong `aud`, `alg:none` -> 401.

## API Test — ownership (IDOR) and idempotency
```python
async def test_get_transfer_of_other_user_returns_404(client, session):
    other = await TransferFactory.create(session, user_id=uuid4())
    resp = await client.get(f"/api/v1/transfers/{other.id}")
    assert resp.status_code == 404

async def test_create_transfer_is_idempotent(client, session, user):
    src = await AccountFactory.create(session, user_id=user.id, balance=Decimal("100"))
    dst = await AccountFactory.create(session)
    body = {"from_account_id": str(src.id), "to_account_id": str(dst.id), "amount": "25.00"}
    headers = {"Idempotency-Key": "idem-key-0001"}

    first = await client.post("/api/v1/transfers", json=body, headers=headers)
    second = await client.post("/api/v1/transfers", json=body, headers=headers)

    assert first.status_code == 201
    assert second.json()["id"] == first.json()["id"]
    await session.refresh(src)
    assert src.balance == Decimal("75.00")         # debited once
```

## Factories
```python
class AccountFactory:
    @staticmethod
    async def create(session: AsyncSession, **overrides) -> Account:
        data = {"id": uuid4(), "user_id": uuid4(), "balance": Decimal("0"), **overrides}
        account = Account(**data)
        session.add(account)
        await session.flush()
        return account
```
`factory_boy` / `polyfactory` work too; keep defaults valid and override only what the test asserts.

## Mocking Outbound HTTP (respx)
```python
import respx
from httpx import Response

@respx.mock
async def test_charge_maps_partner_timeout(settings):
    route = respx.post(f"{settings.partner_url}/charges").mock(
        side_effect=httpx.ConnectTimeout("timeout"))
    with pytest.raises(PartnerUnavailableError):
        await PartnerClient(settings).charge(make_charge())
    assert route.called

@respx.mock
async def test_charge_success():
    respx.post("https://partner.test/charges").mock(return_value=Response(201, json={"id": "c1"}))
    assert (await PartnerClient(test_settings()).charge(make_charge())).id == "c1"
```
`respx` fails on any unmocked request — tests never reach the network.

## Mocking Time and Settings
```python
async def test_otp_expires(mocker):
    mocker.patch("app.features.otp.service.utcnow", return_value=FIXED_NOW + timedelta(minutes=6))
    ...

@pytest.fixture
def settings(monkeypatch) -> Settings:
    monkeypatch.setenv("JWT_ISSUER", "https://issuer.test")
    get_settings.cache_clear()
    return get_settings()
```

## Django (if the project uses it)
- `pytest-django`: `@pytest.mark.django_db` (transaction rolled back per test), `client` / `APIClient`
- `settings` fixture to override settings; `django_assert_num_queries(n)` to guard against N+1

## Rules
- One behaviour per test; name `test_<unit>_<condition>_<expected>`
- Assert status code AND body; cover 401/403/404/422 for every new endpoint
- No `time.sleep`, no real network, no shared mutable state between tests
- Never log or snapshot real secrets in fixtures; test tokens signed with a test-only key
