# FastAPI Patterns Quick Reference

## Layer Responsibilities
| Layer | File | Does | Never |
|---|---|---|---|
| Router | `router.py` | parse, `Depends`, call service, map response | SQL, business rules, `session.commit()` |
| Service | `service.py` | business rules, ownership, transaction boundary | HTTP types (`Request`, `HTTPException`) |
| Repository | `repository.py` | queries with bound params, always scoped by owner | commit, business decisions |
| Schemas | `schemas.py` | Pydantic v2 input/output contracts | ORM objects in responses |

## Settings (pydantic-settings)
```python
from functools import lru_cache
from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    database_url: SecretStr            # from env/vault — no default value
    jwt_issuer: str
    jwt_audience: str
    debug: bool = False                # never True in production

@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
```

## Async Session
```python
from collections.abc import AsyncIterator
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

engine = create_async_engine(
    get_settings().database_url.get_secret_value(),
    pool_size=10, max_overflow=5, pool_pre_ping=True,
)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session
```

## Schemas (Pydantic v2)
```python
from decimal import Decimal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field

class TransferCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")            # reject unknown fields (no `role`, `is_internal`)
    from_account_id: UUID
    to_account_id: UUID
    amount: Decimal = Field(gt=0, max_digits=18, decimal_places=2)
    note: str | None = Field(default=None, max_length=140)

class TransferOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    amount: Decimal
    status: str
```

## Repository (owner-scoped, bound parameters)
```python
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

class AccountRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_owned(self, account_id: UUID, user_id: UUID, *,
                        for_update: bool = False) -> Account | None:
        stmt = select(Account).where(Account.id == account_id, Account.user_id == user_id)
        if for_update:
            stmt = stmt.with_for_update()
        return await self._session.scalar(stmt)

    async def get_for_update(self, account_id: UUID) -> Account | None:
        stmt = select(Account).where(Account.id == account_id).with_for_update()
        return await self._session.scalar(stmt)

    async def list_owned(self, user_id: UUID, limit: int, offset: int) -> list[Account]:
        stmt = (
            select(Account)
            .where(Account.user_id == user_id)
            .options(selectinload(Account.transfers))     # no N+1
            .order_by(Account.created_at.desc())
            .limit(limit).offset(offset)
        )
        return list(await self._session.scalars(stmt))
```
Raw SQL only through `text()` with bound params: `text("... WHERE id = :id")`, `{"id": id}`.

## Service (business rules + transaction)
```python
class TransferService:
    def __init__(self, session: AsyncSession, accounts: AccountRepository,
                 transfers: TransferRepository) -> None:
        self._session, self._accounts, self._transfers = session, accounts, transfers

    async def create(self, user_id: UUID, data: TransferCreate, idem_key: str) -> Transfer:
        async with self._session.begin():                     # one transaction, commit on exit
            existing = await self._transfers.get_by_idempotency_key(user_id, idem_key)
            if existing:
                return existing                               # replay, not a second debit
            source = await self._accounts.get_owned(data.from_account_id, user_id, for_update=True)
            if source is None:
                raise NotFoundError("account")               # not owned == not found
            if source.balance < data.amount:
                raise BusinessRuleError("insufficient_funds")
            target = await self._accounts.get_for_update(data.to_account_id)
            if target is None:
                raise NotFoundError("account")
            source.balance -= data.amount
            target.balance += data.amount
            transfer = await self._transfers.add(user_id, source, target, data, idem_key)
        return transfer
```
A unique constraint on `(user_id, idempotency_key)` closes the race the pre-check leaves open.
Lock rows in a stable order (e.g. by id) when two accounts are involved, to avoid deadlocks.
`session.begin()` must open the first statement — after autobegin it raises; otherwise
call `await session.commit()` explicitly at the end of the service method.

## Dependencies (Depends)
```python
from typing import Annotated
from fastapi import Depends

SessionDep = Annotated[AsyncSession, Depends(get_session)]

async def get_current_user(token: Annotated[str, Depends(oauth2_scheme)],
                           settings: Annotated[Settings, Depends(get_settings)]) -> User:
    claims = verify_access_token(token, settings)   # signature, alg allowlist, exp/iss/aud
    return User.from_claims(claims)

CurrentUser = Annotated[User, Depends(get_current_user)]

def get_transfer_service(session: SessionDep) -> TransferService:
    return TransferService(session, AccountRepository(session), TransferRepository(session))
```

## Router
```python
from fastapi import APIRouter, Header, status

router = APIRouter(prefix="/api/v1/transfers", tags=["transfers"])

@router.post("", response_model=TransferOut, status_code=status.HTTP_201_CREATED)
async def create_transfer(
    body: TransferCreate,
    user: CurrentUser,
    service: Annotated[TransferService, Depends(get_transfer_service)],
    idempotency_key: Annotated[str, Header(min_length=8, max_length=64)],
) -> Transfer:
    return await service.create(user.id, body, idempotency_key)

@router.get("/{transfer_id}", response_model=TransferOut)
async def get_transfer(transfer_id: UUID, user: CurrentUser,
                       service: Annotated[TransferService, Depends(get_transfer_service)]) -> Transfer:
    return await service.get_owned(transfer_id, user.id)
```

## Error Handling (one envelope)
```python
class DomainError(Exception):
    status_code = 400
    def __init__(self, code: str) -> None:
        self.code = code

class NotFoundError(DomainError):
    status_code = 404

class BusinessRuleError(DomainError):
    status_code = 409

@app.exception_handler(DomainError)
async def domain_error_handler(request: Request, exc: DomainError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"code": exc.code, "request_id": request.state.request_id}},
    )
```
Unhandled exceptions: log with `logger.exception` (no request body), return a generic 500.

## Logging (structured, masked)
```python
logger.info("transfer.created", extra={"transfer_id": str(t.id), "user_id": str(user_id),
                                        "request_id": request_id})
# never: logger.info(f"login {username} {password}") / tokens / full PAN
```

## Outbound HTTP
```python
async with httpx.AsyncClient(base_url=settings.partner_url, timeout=httpx.Timeout(10.0)) as client:
    resp = await client.post("/charges", json=payload)
    resp.raise_for_status()
```
Base URL from settings, never from the request; user-supplied URLs pass a domain allowlist
and a private-IP block before any fetch.

## App Factory
```python
def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(docs_url=None if not settings.debug else "/docs", openapi_url=None
                  if not settings.debug else "/openapi.json")
    app.include_router(transfers_router)
    app.add_exception_handler(DomainError, domain_error_handler)
    app.add_middleware(RequestIdMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)
    return app
```
