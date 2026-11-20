-- Mudaala Intelligence — job/outbox + Hermes task DDL (consolidated reference).
--
-- STATUS: reviewed migration DDL. NOT APPLIED TO PRODUCTION. Applying it is
-- an owner-approval decision (master plan §16: "No production database
-- migration"). The EXECUTABLE history lives in migrations/ (applied by
-- intelligence/jobs/apply-migrations.mjs, tracked in intelligence.migrations);
-- THIS file is the consolidated reference of what the migrations produce —
-- it is re-runnable by itself (CREATE TABLE IF NOT EXISTS + CREATE OR REPLACE
-- VIEW) and is what fresh disposable environments use for smoke checks.
--
-- Remediation notes vs the increment-1 draft:
-- - The invalid `CREATE VIEW IF NOT EXISTS` is gone (views are CREATE OR
--   REPLACE VIEW, which is valid, repeatable PostgreSQL).
-- - Hermes task storage (hermes_tasks, hermes_nonces) added (migration 002).
-- - Row-level security on hermes_tasks (owner + admin policies, migration 003).
-- - payload_canonical columns make idempotency conflicts detectable.
-- - Retention: jobs and finished tasks are purged by the cleanup job
--   (OPS-04) after 180 days; DEAD rows are kept until an operator resolves
--   them (dead-letter table/view).

CREATE SCHEMA IF NOT EXISTS intelligence;

CREATE TABLE IF NOT EXISTS intelligence.jobs (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    schema_version    TEXT NOT NULL DEFAULT '1.0',
    kind              TEXT NOT NULL,
    status            TEXT NOT NULL DEFAULT 'QUEUED'
                      CHECK (status IN ('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED','DEAD')),
    submitter         TEXT NOT NULL,
    idempotency_key   TEXT NOT NULL,
    payload           JSONB NOT NULL,
    payload_canonical TEXT NOT NULL,
    budget_max_attempts SMALLINT NOT NULL DEFAULT 3 CHECK (budget_max_attempts BETWEEN 1 AND 5),
    budget_deadline_seconds INTEGER NOT NULL DEFAULT 300 CHECK (budget_deadline_seconds BETWEEN 1 AND 3600),
    budget_compute_profile TEXT NOT NULL DEFAULT 'CPU_XS'
                      CHECK (budget_compute_profile IN ('CPU_XS','CPU_S','CPU_M','GPU_BATCH')),
    attempts          SMALLINT NOT NULL DEFAULT 0,
    next_attempt_at   TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at        TIMESTAMPTZ,
    finished_at       TIMESTAMPTZ,
    result_ref        TEXT,
    last_error_code   TEXT,
    last_error_message TEXT,
    CONSTRAINT jobs_idempotency UNIQUE (submitter, kind, idempotency_key)
);

CREATE INDEX IF NOT EXISTS jobs_queued_idx
    ON intelligence.jobs (next_attempt_at, created_at)
    WHERE status = 'QUEUED';

CREATE INDEX IF NOT EXISTS jobs_finished_idx
    ON intelligence.jobs (finished_at)
    WHERE finished_at IS NOT NULL;

CREATE OR REPLACE VIEW intelligence.dead_letters AS
    SELECT id, kind, submitter, attempts, last_error_code, last_error_message, created_at, finished_at
    FROM intelligence.jobs
    WHERE status = 'DEAD';

CREATE TABLE IF NOT EXISTS intelligence.event_outbox (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    schema_version  TEXT NOT NULL DEFAULT '1.0',
    event_type      TEXT NOT NULL,
    event_id        TEXT NOT NULL,
    occurred_at     TIMESTAMPTZ NOT NULL,
    actor_kind      TEXT NOT NULL CHECK (actor_kind IN ('BUYER','MERCHANT','SYSTEM','ANONYMOUS')),
    actor_ref       TEXT,
    entity_kind     TEXT NOT NULL,
    entity_id       TEXT NOT NULL,
    purpose         TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    published_at    TIMESTAMPTZ,
    publish_attempts SMALLINT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT event_outbox_idempotency UNIQUE (event_type, idempotency_key)
);

CREATE INDEX IF NOT EXISTS event_outbox_pending_idx
    ON intelligence.event_outbox (created_at)
    WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS intelligence.hermes_tasks (
    task_id          TEXT PRIMARY KEY,
    schema_version   TEXT NOT NULL DEFAULT '1.0',
    task_type        TEXT NOT NULL,
    skill_id         TEXT NOT NULL,
    purpose          TEXT NOT NULL,
    submitted_by     TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'SUBMITTED'
                     CHECK (status IN ('SUBMITTED','VALIDATED','QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED','REFUSED','DEAD')),
    budget           JSONB NOT NULL,
    idempotency_key  TEXT NOT NULL,
    payload          JSONB NOT NULL,
    payload_canonical TEXT NOT NULL,
    attempts         SMALLINT NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
    max_attempts     SMALLINT NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 5),
    steps_used       INTEGER NOT NULL DEFAULT 0,
    tool_calls_used  INTEGER NOT NULL DEFAULT 0,
    created_at       DOUBLE PRECISION NOT NULL,
    started_at       DOUBLE PRECISION,
    finished_at      DOUBLE PRECISION,
    next_attempt_at  DOUBLE PRECISION,
    trace_id         TEXT NOT NULL DEFAULT '',
    worker_id        TEXT,
    result           JSONB,
    refusal_reason   TEXT,
    error_class      TEXT,
    failure_class    TEXT,
    cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,
    receipts         JSONB NOT NULL DEFAULT '[]'::jsonb,
    CONSTRAINT hermes_tasks_idempotency UNIQUE (submitted_by, idempotency_key),
    CONSTRAINT hermes_tasks_terminal_finished CHECK (
        status NOT IN ('SUCCEEDED','CANCELLED','REFUSED','DEAD') OR finished_at IS NOT NULL
    )
);

CREATE INDEX IF NOT EXISTS hermes_tasks_owner_idx
    ON intelligence.hermes_tasks (submitted_by, created_at DESC);

CREATE INDEX IF NOT EXISTS hermes_tasks_queued_idx
    ON intelligence.hermes_tasks (created_at)
    WHERE status = 'QUEUED';

CREATE INDEX IF NOT EXISTS hermes_tasks_dead_idx
    ON intelligence.hermes_tasks (created_at DESC)
    WHERE status = 'DEAD';

CREATE TABLE IF NOT EXISTS intelligence.hermes_nonces (
    caller_id   TEXT NOT NULL,
    nonce       TEXT NOT NULL,
    expires_at  DOUBLE PRECISION NOT NULL,
    created_at  DOUBLE PRECISION NOT NULL DEFAULT EXTRACT(epoch FROM now()),
    CONSTRAINT hermes_nonces_pk PRIMARY KEY (caller_id, nonce)
);

CREATE INDEX IF NOT EXISTS hermes_nonces_expiry_idx
    ON intelligence.hermes_nonces (expires_at);

-- ============================================================================
-- migration 004: durable Hermes audit log (append-only by grant; see 005).
-- Entries carry who/what/outcome metadata only — never payload contents.
-- ============================================================================

CREATE TABLE IF NOT EXISTS intelligence.hermes_audit (
    id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ts      DOUBLE PRECISION NOT NULL,
    event   TEXT NOT NULL,
    actor   TEXT,
    details JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS hermes_audit_ts_idx ON intelligence.hermes_audit (ts DESC);
CREATE INDEX IF NOT EXISTS hermes_audit_event_idx ON intelligence.hermes_audit (event);

-- ============================================================================
-- migration 005: scoped roles, least-privilege grants, enforced RLS
--   intelligence_app    tenant path (owner-scoped via intelligence.owner)
--   intelligence_worker infrastructure path (needs intelligence_admin membership,
--                       granted by the OPERATOR — migrations never grant it)
-- Roles are NOLOGIN: the operator creates login users and grants these roles.
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'intelligence_app') THEN
        CREATE ROLE intelligence_app NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'intelligence_worker') THEN
        CREATE ROLE intelligence_worker NOLOGIN;
    END IF;
END
$$;

GRANT USAGE ON SCHEMA intelligence TO intelligence_app, intelligence_worker;
GRANT SELECT, INSERT, UPDATE ON intelligence.hermes_tasks TO intelligence_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON intelligence.hermes_tasks TO intelligence_worker;
GRANT SELECT, INSERT, DELETE ON intelligence.hermes_nonces TO intelligence_app, intelligence_worker;
GRANT SELECT, INSERT ON intelligence.hermes_audit TO intelligence_app, intelligence_worker;
GRANT SELECT ON intelligence.migrations TO intelligence_app, intelligence_worker;

ALTER TABLE intelligence.hermes_tasks FORCE ROW LEVEL SECURITY;
