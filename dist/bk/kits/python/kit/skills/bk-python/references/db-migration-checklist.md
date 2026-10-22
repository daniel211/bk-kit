# DB Migration Checklist (Alembic + Django)

## Workflow
1. Change the ORM model.
2. `alembic revision --autogenerate -m "add transfers idempotency key"`
3. **Review the generated file by hand** — autogenerate is a draft, not a migration.
4. `alembic upgrade head` -> `alembic downgrade -1` -> `alembic upgrade head` on a local DB.
5. Run the test suite against the migrated schema; commit model + migration together.

## Autogenerate Review
- [ ] Only the intended changes are present (no spurious drops from unimported models)
- [ ] Renames appear as rename, not drop + add (autogenerate cannot detect renames)
- [ ] Server defaults, enum types, `CHECK` constraints and index names are correct
- [ ] Type changes are explicit (`existing_type=`), including length/precision (`Numeric(18, 2)`)
- [ ] `downgrade()` is implemented and actually reverses `upgrade()`
- [ ] One logical change per revision; `down_revision` chain has a single head (`alembic heads`)

## Expand / Contract (zero downtime)
| Phase | Deploy | Example |
|---|---|---|
| Expand | migration only, old code still works | add nullable column / new table / new index |
| Migrate | code writes both, backfill job | dual-write, batched backfill |
| Contract | after all readers switched | set NOT NULL, drop old column |

- Never rename or drop a column that running code still reads, in one release
- New NOT NULL column: add nullable -> backfill -> `ALTER ... SET NOT NULL` in a later revision
- Adding a column with a volatile default rewrites the table — add without default, then backfill

## Locks on Big Tables (PostgreSQL)
```python
def upgrade() -> None:
    with op.get_context().autocommit_block():          # CONCURRENTLY can't run in a transaction
        op.create_index("ix_transfers_user_id_created_at", "transfers",
                        ["user_id", "created_at"], postgresql_concurrently=True,
                        if_not_exists=True)

def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.drop_index("ix_transfers_user_id_created_at", table_name="transfers",
                      postgresql_concurrently=True, if_exists=True)
```
- Set `lock_timeout` (e.g. `SET lock_timeout = '5s'`) so a blocked DDL fails instead of queueing
- Foreign keys / CHECK on large tables: add `NOT VALID`, then `VALIDATE CONSTRAINT` separately
- MySQL: verify the DDL is `ALGORITHM=INPLACE, LOCK=NONE`, or use an online schema tool

## Data Migrations
- Kept in a **separate revision** from schema changes (or a separate job for large tables)
- Batched (`LIMIT` + keyset on id), idempotent and resumable — never one giant `UPDATE`
- Use `op.execute(sa.text(...).bindparams(...))` with bound parameters — never f-string SQL
- Never import application models into a migration; use `sa.table()` / `sa.column()` snapshots
- Document whether downgrade restores data or is a no-op, and why

## Security & Data
- Money columns `Numeric(precision, scale)`, never `Float`; add `CHECK (amount > 0)` where it applies
- Ownership/tenant columns (`user_id`, `tenant_id`) NOT NULL and indexed
- No secrets, real PII or production data in migration files or seed scripts
- Sensitive columns (tokens, national IDs): stored hashed or encrypted, not plaintext

## Indexes
- Index every column used in WHERE / JOIN / ORDER BY of hot queries; composite in filter order
- Unique constraints for business invariants (`(user_id, idempotency_key)`)
- Remove indexes no query uses — they cost every write

## Release
- [ ] Migration runs as its own deploy step before the new code (expand) or after (contract)
- [ ] Tested on a production-sized copy for duration and locks when touching big tables
- [ ] Rollback plan: `alembic downgrade <rev>` verified, or a forward-fix documented

## Django Migrations
Same expand/contract, lock and data rules as above; Django-specific mechanics:
- CI: `python manage.py makemigrations --check --dry-run` — fails when a model change has no migration
- Review: `python manage.py sqlmigrate <app> <number>`; verify `migrate <app> <previous>` then `migrate`
- Never edit a migration that has been applied anywhere; fix forward with a new one
- Data migrations: `RunPython(forward, reverse_code=backward)` (or `RunPython.noop` with a reason),
  use `apps.get_model("app", "Model")` — never import the app's models; batch by pk
- Postgres big tables: `AddIndexConcurrently` / `RemoveIndexConcurrently` in a migration with
  `atomic = False` (from `django.contrib.postgres.operations`)
- `atomic = False` also for long batched `RunPython`, so each batch commits on its own
- Rename / move without a table rewrite: `SeparateDatabaseAndState(state_operations=[...],
  database_operations=[...])` — state changes in Django, DDL done explicitly (or not at all)
- Raw SQL: `RunSQL(sql, reverse_sql=...)` with params (`[("... WHERE id = %s", [x])]`), never formatted strings

```python
from django.contrib.postgres.operations import AddIndexConcurrently
from django.db import migrations, models

class Migration(migrations.Migration):
    atomic = False                                   # CONCURRENTLY can't run in a transaction
    dependencies = [("transfers", "0008_backfill_transfer_status")]
    operations = [
        AddIndexConcurrently("transfer", models.Index(
            fields=["owner", "status", "-created_at"], name="ix_tr_owner_status_created")),
    ]
```
