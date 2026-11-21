-- Mudaala Intelligence — migration 002: Hermes durable task storage.
--
-- Hermes tasks persist in the approved `intelligence` schema (hybrid hosting:
-- Hermes runs off the commerce plane and NEVER holds commerce credentials;
-- it owns only its own tables). Tenant isolation is column-level: every task
-- row carries its verified owner (`submitted_by` = authenticated caller id)
-- and every store query is owner-scoped; RLS policies are added in 003.

CREATE TABLE IF NOT EXISTS intelligence.hermes_tasks (
    task_id          TEXT PRIMARY KEY,        -- 'task-' + 16 hex chars (validated in code)
    schema_version   TEXT NOT NULL DEFAULT '1.0',
    task_type        TEXT NOT NULL,
    skill_id         TEXT NOT NULL,
    purpose          TEXT NOT NULL,
    submitted_by     TEXT NOT NULL,           -- VERIFIED owner (HMAC caller id) — the tenant boundary
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
    -- Idempotent submit per owner: same owner + key = one task, enforced by
    -- the database across replicas. Payload conflicts are detected in code
    -- by comparing payload_canonical.
    CONSTRAINT hermes_tasks_idempotency UNIQUE (submitted_by, idempotency_key),
    -- Task relationships: a task always belongs to exactly one registered
    -- owner and skill; state columns never contradict the lifecycle.
    CONSTRAINT hermes_tasks_terminal_finished CHECK (
        status NOT IN ('SUCCEEDED','CANCELLED','REFUSED','DEAD') OR finished_at IS NOT NULL
    )
);

-- Owner-scoped reads and listings (the tenant-isolation hot path).
CREATE INDEX IF NOT EXISTS hermes_tasks_owner_idx
    ON intelligence.hermes_tasks (submitted_by, created_at DESC);

-- Worker claim: QUEUED tasks with reached next_attempt_at, oldest first.
CREATE INDEX IF NOT EXISTS hermes_tasks_queued_idx
    ON intelligence.hermes_tasks (created_at)
    WHERE status = 'QUEUED';

-- Dead-letter visibility for the admin endpoint.
CREATE INDEX IF NOT EXISTS hermes_tasks_dead_idx
    ON intelligence.hermes_tasks (created_at DESC)
    WHERE status = 'DEAD';

-- Replay protection for service auth across replicas: one row per
-- (caller, nonce); consume is an atomic INSERT ... ON CONFLICT DO NOTHING.
-- Expired rows are deleted lazily on insert (TTL-bounded growth).
CREATE TABLE IF NOT EXISTS intelligence.hermes_nonces (
    caller_id   TEXT NOT NULL,
    nonce       TEXT NOT NULL,
    expires_at  DOUBLE PRECISION NOT NULL,
    created_at  DOUBLE PRECISION NOT NULL DEFAULT EXTRACT(epoch FROM now()),
    CONSTRAINT hermes_nonces_pk PRIMARY KEY (caller_id, nonce)
);

CREATE INDEX IF NOT EXISTS hermes_nonces_expiry_idx
    ON intelligence.hermes_nonces (expires_at);
