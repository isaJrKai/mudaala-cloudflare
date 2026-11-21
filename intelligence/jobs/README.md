# Intelligence jobs — async contract and durable-store draft

**Status:** Contract implemented (`../contracts/jobs.ts`); durable store is a reviewed draft. Nothing applied anywhere.

## What exists now

- `../contracts/jobs.ts` — job kinds, state machine (`QUEUED → RUNNING → SUCCEEDED/FAILED/CANCELLED/DEAD`), budget caps (≤5 attempts, ≤1 h deadline, 32 KiB payload), bounded backoff, GPU-approval flag. Contract-tested on both planes' sides (TS here, mirrored semantics in Hermes Python).
- Gateway `/v1/jobs` — submission API with idempotent replay detection (content-equal payload replays; different payload → 409 `IDEMPOTENCY_CONFLICT`), submitter-scoped records and a bounded retention sweep (staging memory store).
- `migrations/` — **executable, tracked migrations** (001 jobs+outbox, 002 Hermes tasks+nonces, 003 row-level security, 004 durable audit table, 005 scoped roles + grants + FORCE RLS). Applied by `apply-migrations.mjs` (or the Hermes store) in order, recorded in `intelligence.migrations`; re-running is a no-op. The increment-1 draft's invalid `CREATE VIEW IF NOT EXISTS` is gone (`CREATE OR REPLACE VIEW`).
- `schema.sql` — the corrected consolidated reference of the migration head (also re-runnable standalone).
- `dev-postgres.mjs` — disposable embedded PostgreSQL for local tests (no docker, never production).
- `schema.test.ts` + Hermes `test_storage_postgres.py` — the SQL gate: fresh install, repeatable re-run, idempotency constraints, dead-letter view, lifecycle CHECKs, NOT NULL owner column, RLS policies — all verified against a disposable instance.

## Migration procedure (ADR-0004)

```bash
DATABASE_URL=postgres://<staging> bun run intelligence/jobs/apply-migrations.mjs "$DATABASE_URL"
# re-running is a no-op; migrations are tracked in intelligence.migrations
```

1. Owner reviews `migrations/` (three files) and `schema.sql` (consolidated reference).
2. Apply to a staging/disposable Postgres first — NEVER production without approval (master plan §16). Verified fresh + repeatable by `schema.test.ts` and the Hermes PG suite.
3. Wire the gateway's `JobStore` adapter / Hermes `PostgresTaskStore` (Hermes store applies the same migrations on init when `apply_migrations=True`).
4. Run the reconciliation sweep + dead-letter drill.

**Rollback:** each migration is additive (`CREATE ... IF NOT EXISTS` / `CREATE OR REPLACE VIEW`); rollback is `DROP SCHEMA intelligence CASCADE` for the whole plane (documented; loses intelligence-plane data only, never commerce data) or targeted `DROP TABLE/VIEW` per object. Both are owner-approval operations.

**Row-level security (enforced, not just declared):** `hermes_tasks` carries owner + admin policies AND `FORCE ROW LEVEL SECURITY` (migration 005), so even the table-owning role is subject to them. The role model:

| Role | Purpose | How it sees rows |
|---|---|---|
| `intelligence_app` | tenant request path | policy compares `submitted_by` to the transaction-scoped `intelligence.owner` setting — the store sets it via `set_config(..., is_local => true)` per transaction from the VERIFIED caller id |
| `intelligence_worker` | claims, recovery, retention, admin reads | must hold `intelligence_admin` membership — **granted by the operator, never by migrations:** `GRANT intelligence_admin TO intelligence_worker;` |
| `intelligence_admin` | administrator boundary (created by 003) | membership = cross-tenant access; app roles deliberately never hold it |

Roles are created NOLOGIN — the operator creates login users per environment and grants these roles (`CREATE USER ...; GRANT intelligence_app TO ...;`). Superusers and `BYPASSRLS` roles still bypass RLS by design; deployments connect as the app role. ENFORCEMENT IS TESTED: the Hermes PG suite runs dedicated login roles with exactly the migration-005 grants and proves rows are invisible without (and with a wrong) owner context, writes are rejected without context, the app role cannot drive worker/admin paths, and the audit table is append-only for app roles (SELECT+INSERT grants only, migration 004/005).

**Connection/ownership model (round 3):** lifecycle saves (`save()`) carry the record's own owner context, so the synchronous request path (route → execute → save) works on a RESTRICTED tenant connection even with no `HERMES_ADMIN_DATABASE_URL` wired. Unscoped infrastructure operations (worker claims, retention, cross-tenant admin reads) remain structurally admin-only: the store PROBES the infrastructure connection at startup (superuser/BYPASSRLS, unforced owner, or `intelligence_admin` membership) — without capability it announces exactly which operations are unavailable, and **worker mode without an infrastructure-capable role FAILS STARTUP** instead of running a silently idle worker.

## Why not Cloudflare Queues already

No Queues binding exists; provider semantics (delivery guarantees, retry, dead-letter, cost) are untested; and adding a binding to the commerce Worker now would repeat the CPU-pressure pattern documented in PR #342. The outbox pattern works with what exists today.
