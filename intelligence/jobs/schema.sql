-- Mudaala Intelligence — job/outbox DRAFT schema (ADR-0004).
--
-- NOT APPLIED ANYWHERE. This file is the reviewed proposal for the durable
-- job store; applying it requires explicit owner approval (master plan §16:
-- "No production database migration"). It targets a SEPARATE `intelligence`
-- schema so commerce tables and intelligence metadata never share a namespace.
--
-- Design notes:
-- - Postgres-backed outbox first: the commerce plane writes domain changes
--   and outbox rows in ONE transaction (never a fire-and-forget HTTP publish
--   from the Worker — master plan §6.2, Worker CPU constraint from PR #342).
-- - A dispatcher later publishes to the chosen broker (Cloudflare Queues or
--   an external one) after provider semantics are tested; the table is the
--   seam and the reconciliation source of truth either way.
-- - Mirrors intelligence/contracts/jobs.ts (schema_version 1.0): states
--   QUEUED → RUNNING → SUCCEEDED/FAILED/CANCELLED/DEAD, bounded attempts,
--   idempotency per submitter, budget fields including the GPU approval gate.
-- - Retention: rows are purged after 180 days by the cleanup job (OPS-04);
--   DEAD rows are kept until an operator resolves them (dead-letter table).

CREATE SCHEMA IF NOT EXISTS intelligence;

CREATE TABLE IF NOT EXISTS intelligence.jobs (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    schema_version    TEXT NOT NULL DEFAULT '1.0',
    kind              TEXT NOT NULL,            -- allowlist enforced in code (contracts/jobs.ts)
    status            TEXT NOT NULL DEFAULT 'QUEUED'
                      CHECK (status IN ('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED','DEAD')),
    submitter         TEXT NOT NULL,            -- gateway caller id or 'hermes'
    idempotency_key   TEXT NOT NULL,
    payload           JSONB NOT NULL,
    budget_max_attempts SMALLINT NOT NULL DEFAULT 3 CHECK (budget_max_attempts BETWEEN 1 AND 5),
    budget_deadline_seconds INTEGER NOT NULL DEFAULT 300 CHECK (budget_deadline_seconds BETWEEN 1 AND 3600),
    budget_compute_profile TEXT NOT NULL DEFAULT 'CPU_XS'
                      CHECK (budget_compute_profile IN ('CPU_XS','CPU_S','CPU_M','GPU_BATCH')),
    attempts          SMALLINT NOT NULL DEFAULT 0,
    next_attempt_at   TIMESTAMPTZ,             -- for bounded backoff scheduling
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at        TIMESTAMPTZ,
    finished_at       TIMESTAMPTZ,
    result_ref        TEXT,                    -- object-storage/artifact ref, never inline payloads
    last_error_code   TEXT,
    last_error_message TEXT,
    -- Enforced uniqueness: same submitter + kind + key = one job (idempotent submit).
    CONSTRAINT jobs_idempotency UNIQUE (submitter, kind, idempotency_key)
);

-- Queue-pickup index: dispatcher claims QUEUED jobs with reached next_attempt_at.
CREATE INDEX IF NOT EXISTS jobs_queued_idx
    ON intelligence.jobs (next_attempt_at, created_at)
    WHERE status = 'QUEUED';

-- Dead-letter view with operator visibility (reconciliation, ADR-0004 §5).
CREATE VIEW IF NOT EXISTS intelligence.dead_letters AS
    SELECT id, kind, submitter, attempts, last_error_code, last_error_message, created_at, finished_at
    FROM intelligence.jobs
    WHERE status = 'DEAD';

-- Domain-event outbox for commerce-plane emission (written in the SAME
-- transaction as the domain change; dispatched by a separate worker).
CREATE TABLE IF NOT EXISTS intelligence.event_outbox (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    schema_version  TEXT NOT NULL DEFAULT '1.0',
    event_type      TEXT NOT NULL,            -- allowlist enforced in code (contracts/events.ts)
    event_id        TEXT NOT NULL,
    occurred_at     TIMESTAMPTZ NOT NULL,
    actor_kind      TEXT NOT NULL CHECK (actor_kind IN ('BUYER','MERCHANT','SYSTEM','ANONYMOUS')),
    actor_ref       TEXT,                     -- pseudonymous; raw ids are never written here
    entity_kind     TEXT NOT NULL,
    entity_id       TEXT NOT NULL,
    purpose         TEXT NOT NULL,            -- must be a DECLARED_PURPOSE (contracts/events.ts)
    idempotency_key TEXT NOT NULL,
    published_at    TIMESTAMPTZ,              -- NULL = pending dispatch
    publish_attempts SMALLINT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT event_outbox_idempotency UNIQUE (event_type, idempotency_key)
);

CREATE INDEX IF NOT EXISTS event_outbox_pending_idx
    ON intelligence.event_outbox (created_at)
    WHERE published_at IS NULL;

-- Reconciliation: jobs stuck in RUNNING past their deadline are re-queued or
-- dead-lettered by a periodic sweep; the query below is the alert source.
-- SELECT count(*) FROM intelligence.jobs
--  WHERE status = 'RUNNING' AND started_at < now() - interval '1 hour';
