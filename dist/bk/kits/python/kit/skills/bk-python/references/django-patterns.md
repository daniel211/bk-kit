# Django + DRF Patterns Quick Reference

## Layer Responsibilities
| Layer | File | Does | Never |
|---|---|---|---|
| View / ViewSet | `views.py` | auth + permissions, scoped queryset, call service, serialize | business rules, raw SQL, `transaction.atomic` |
| Serializer | `serializers.py` | input type/length/format, output shape | DB writes with side effects, authz decisions |
| Service | `services.py` | business rules, ownership, transaction boundary | `request`, `Response`, DRF exceptions below domain level |
| Manager / QuerySet | `managers.py` | reusable owner/tenant-scoped queries | commit decisions, HTTP concerns |
| Model | `models.py` | fields, constraints, indexes | cross-aggregate business logic |

## App Layout
```
config/                     # settings/{base,prod,test}.py, urls.py, asgi.py, wsgi.py
apps/
└── transfers/
    ├── apps.py  models.py  managers.py  services.py
    ├── serializers.py  views.py  permissions.py  urls.py
    ├── migrations/
    └── tests/              # test_api.py, test_services.py, factories.py
manage.py
```

## Settings (from env, safe defaults)
```python
import environ  # django-environ; os.environ works the same way

env = environ.Env(DEBUG=(bool, False))                       # DEBUG False unless env says otherwise
SECRET_KEY = env("DJANGO_SECRET_KEY")                         # no default — fail fast if missing
DEBUG = env("DEBUG")
ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS", default=[])  # never ["*"] in prod
DATABASES = {"default": env.db("DATABASE_URL")}
CSRF_TRUSTED_ORIGINS = env.list("CSRF_TRUSTED_ORIGINS", default=[])

SECURE_SSL_REDIRECT = not DEBUG
SESSION_COOKIE_SECURE = CSRF_COOKIE_SECURE = not DEBUG
SESSION_COOKIE_HTTPONLY = True
SECURE_HSTS_SECONDS = 0 if DEBUG else 31_536_000
SECURE_HSTS_INCLUDE_SUBDOMAINS = not DEBUG
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"

REST_FRAMEWORK = {
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],  # never AllowAny
    "DEFAULT_AUTHENTICATION_CLASSES": ["apps.auth.authentication.SsoJWTAuthentication"],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.LimitOffsetPagination",
    "PAGE_SIZE": 20,
    "DEFAULT_THROTTLE_RATES": {"login": "5/min", "otp": "3/min"},
}
```
Run `python manage.py check --deploy` against prod settings in CI. Admin on a non-default path,
behind SSO/VPN; `MIDDLEWARE` keeps `CsrfViewMiddleware` and `SecurityMiddleware`.

## Models + Managers (owner/tenant scoping lives here)
```python
import uuid
from decimal import Decimal
from django.conf import settings
from django.db import models

class AccountQuerySet(models.QuerySet["Account"]):
    def owned_by(self, user) -> "AccountQuerySet":
        return self.filter(owner=user)

class Account(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)  # no sequential ids
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="accounts")
    balance = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))
    objects = AccountQuerySet.as_manager()

class Transfer(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    source = models.ForeignKey(Account, on_delete=models.PROTECT, related_name="outgoing")
    target = models.ForeignKey(Account, on_delete=models.PROTECT, related_name="incoming")
    amount = models.DecimalField(max_digits=18, decimal_places=2)
    idempotency_key = models.CharField(max_length=64)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["owner", "idempotency_key"], name="uq_transfer_owner_idem"),
            models.CheckConstraint(condition=models.Q(amount__gt=0), name="ck_transfer_amount_pos"),
        ]  # Django < 5.1: `check=` instead of `condition=`
        indexes = [models.Index(fields=["owner", "-created_at"])]
```

## Serializers (validation at the boundary)
```python
from decimal import Decimal
from rest_framework import serializers

class TransferCreateSerializer(serializers.Serializer):
    from_account_id = serializers.UUIDField()
    to_account_id = serializers.UUIDField()
    amount = serializers.DecimalField(max_digits=18, decimal_places=2, min_value=Decimal("0.01"))
    note = serializers.CharField(max_length=140, required=False, allow_blank=True)

    def validate(self, attrs):
        if attrs["from_account_id"] == attrs["to_account_id"]:
            raise serializers.ValidationError("same_account")
        return attrs

class TransferOutSerializer(serializers.ModelSerializer):
    class Meta:
        model = Transfer
        fields = ["id", "amount", "created_at"]          # explicit list — never "__all__"
        read_only_fields = fields
```
Unknown fields are ignored, never trusted: `owner`, `role`, `is_staff` come from `request.user`,
not the body. `ModelSerializer` for writes: list `fields` explicitly and mark sensitive ones read-only.

## Service (transaction + row locks + idempotency)
```python
from django.db import IntegrityError, transaction

class NotFound(Exception): ...
class InsufficientFunds(Exception): ...

def create_transfer(*, user, data: dict, idem_key: str) -> Transfer:
    existing = Transfer.objects.filter(owner=user, idempotency_key=idem_key).first()
    if existing:
        return existing                                           # replay, not a second debit
    try:
        with transaction.atomic():
            ids = sorted([data["from_account_id"], data["to_account_id"]])   # stable lock order
            locked = {a.id: a for a in Account.objects.select_for_update().filter(id__in=ids)}
            source, target = locked.get(data["from_account_id"]), locked.get(data["to_account_id"])
            if source is None or source.owner_id != user.id or target is None:
                raise NotFound("account")                         # not owned == not found
            if source.balance < data["amount"]:
                raise InsufficientFunds()
            source.balance -= data["amount"]
            target.balance += data["amount"]
            Account.objects.bulk_update([source, target], ["balance"])
            return Transfer.objects.create(owner=user, source=source, target=target,
                                           amount=data["amount"], idempotency_key=idem_key)
    except IntegrityError:                                        # concurrent replay lost the race
        return Transfer.objects.get(owner=user, idempotency_key=idem_key)
```
`select_for_update()` only works inside `atomic()`. Side effects (emails, Celery tasks) go in
`transaction.on_commit(lambda: ...)` so they never fire for a rolled-back write.

## ViewSet (scoped queryset + object permission)
```python
from rest_framework import mixins, permissions, status, viewsets
from rest_framework.exceptions import NotFound as Http404, ValidationError
from rest_framework.response import Response

class IsOwner(permissions.BasePermission):
    def has_object_permission(self, request, view, obj) -> bool:
        return obj.owner_id == request.user.id

class TransferViewSet(mixins.CreateModelMixin, mixins.RetrieveModelMixin,
                      mixins.ListModelMixin, viewsets.GenericViewSet):
    permission_classes = [permissions.IsAuthenticated, IsOwner]
    serializer_class = TransferOutSerializer

    def get_queryset(self):
        # IDOR guard: other users' rows are never in the queryset -> retrieve returns 404
        return (Transfer.objects.filter(owner=self.request.user)
                .select_related("source", "target").order_by("-created_at"))

    def create(self, request):
        key = request.headers.get("Idempotency-Key", "")
        if not 8 <= len(key) <= 64:
            raise ValidationError({"Idempotency-Key": "required, 8-64 chars"})
        body = TransferCreateSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        try:
            transfer = create_transfer(user=request.user, data=body.validated_data, idem_key=key)
        except NotFound:
            raise Http404()
        except InsufficientFunds:
            return Response({"error": {"code": "insufficient_funds"}}, status=status.HTTP_409_CONFLICT)
        return Response(TransferOutSerializer(transfer).data, status=status.HTTP_201_CREATED)
```
Scoped `get_queryset` is the primary control; `IsOwner` is defense in depth (it only runs on
`get_object()`). Multi-tenant: filter `tenant=request.user.tenant` the same way, in every queryset.
Function views: `@api_view` + `@permission_classes`; plain Django views: `@login_required`.

## Queries
- Forward FK / one-to-one: `select_related("source")`; reverse FK / M2M: `prefetch_related("transfers")`
- Custom prefetch: `Prefetch("transfers", queryset=Transfer.objects.filter(owner=user))`
- `.only()` / `.values()` for wide tables; `.exists()` not `len(qs)`; `.iterator(chunk_size=2000)` for batch jobs
- Raw SQL only with params: `Model.objects.raw("... WHERE id = %s", [obj_id])`,
  `cursor.execute("... WHERE id = %s", [obj_id])` — never f-strings, `%` formatting, `.extra()`
- Templates auto-escape; never `mark_safe` / `|safe` on user data

## Migrations Workflow
1. Change the model -> `python manage.py makemigrations <app>` -> read the file.
2. `python manage.py sqlmigrate <app> <number>` to see the SQL (locks, rewrites).
3. `python manage.py migrate` -> `migrate <app> <previous>` -> `migrate` locally.
4. CI: `python manage.py makemigrations --check --dry-run` fails on model changes without a migration.
Big-table rules: see `db-migration-checklist.md` (Django section).

## Tests (pytest-django)
```toml
# pyproject.toml
[tool.pytest.ini_options]
DJANGO_SETTINGS_MODULE = "config.settings.test"
addopts = "--reuse-db"
```
```python
import pytest
from decimal import Decimal
from rest_framework.test import APIClient

@pytest.fixture
def user(django_user_model):
    return django_user_model.objects.create_user(username="alice", password=None)

@pytest.fixture
def api_client(user) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client

@pytest.mark.django_db
def test_other_users_transfer_is_404(api_client, transfer_factory, other_user):
    t = transfer_factory(owner=other_user)
    assert api_client.get(f"/api/v1/transfers/{t.id}/").status_code == 404

@pytest.mark.django_db
@pytest.mark.parametrize("amount", ["0", "-1", "0.001"])
def test_invalid_amount_rejected(api_client, accounts, amount):
    r = api_client.post("/api/v1/transfers/", {"from_account_id": accounts[0].id,
                        "to_account_id": accounts[1].id, "amount": amount},
                        format="json", HTTP_IDEMPOTENCY_KEY="key-12345")
    assert r.status_code == 400

@pytest.mark.django_db
def test_list_has_no_n_plus_one(api_client, transfer_factory, user, django_assert_num_queries):
    transfer_factory.create_batch(10, owner=user)
    with django_assert_num_queries(2):                       # count + page
        api_client.get("/api/v1/transfers/")
```
- DRF returns **400** for validation errors (not 422) — assert what the project's handler maps.
- `@pytest.mark.django_db(transaction=True)` for code using `on_commit` or `select_for_update` races;
  or `django_capture_on_commit_callbacks(execute=True)`.
- Factories via `factory_boy` (`DjangoModelFactory`); no fixtures-with-data JSON.
- Without pytest-django the project runs `python manage.py test` (`TestCase`, `APITestCase`).
- Every new endpoint: 201/200, 401 unauthenticated, 404 other user's object, 400 invalid input.
