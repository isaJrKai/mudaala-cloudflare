-- Mudaala Intelligence — migration 006: durable execution (leases + receipts).
--
-- Round-4 remediation (Hermes durable execution across application
-- instances). Two gaps in the round-1..3 schema become durable, database-
-- backed state:
--
-- 1. Execution lease. Claims were atomic (FOR UPDATE SKIP LOCKED), but the
--    stale-RUNNING recovery keyed on a fixed started_at age, so a legitimate
--    long-running task was requeued while still executing and a second
--    instance could run the same task concurrently. hermes_tasks gains
--    lease_expires_at: claims and lease renewals (worker heartbeats) extend
--    it, and recovery requeues only tasks whose lease has actually expired.
--
-- 2. Receipts as rows. Execution receipts lived in a JSONB column on the
--    task row, appended by a read-modify-write save() — a lost-update race
--    across instances (last writer wins, receipts vanish). Receipts now
--    have their own append-only table with a UNIQUE (task_id, attempt)
--    constraint; the JSONB column stays in sync inside the same transaction
--    for read-model compatibility. Existing JSONB receipts are backfilled.

ALTER TABLE intelligence.hermes_tasks
    ADD COLUMN IF NOT EXISTS lease_expires_at DOUBLE PRECISION;

-- Recovery scans RUNNING rows only; the partial index keeps that scan cheap.
CREATE INDEX IF NOT EXISTS hermes_tasks_running_idx
    ON intelligence.hermes_tasks (lease_expires_at)
    WHERE status = 'RUNNING';

CREATE TABLE IF NOT EXISTS intelligence.hermes_receipts (
    receipt_id   TEXT PRIMARY KEY,       -- 'rcpt-' + task_id + '-' + attempt (deterministic → idempotent append)
    task_id      TEXT NOT NULL REFERENCES intelligence.hermes_tasks (task_id) ON DELETE CASCADE,
    submitted_by TEXT NOT NULL,          -- tenant boundary, mirrored from the task row
    attempt      SMALLINT NOT NULL CHECK (attempt BETWEEN 1 AND 5),
    worker_id    TEXT NOT NULL DEFAULT '',
    trace_id     TEXT NOT NULL DEFAULT '',
    started_at   DOUBLE PRECISION NOT NULL,
    finished_at  DOUBLE PRECISION,
    outcome      TEXT NOT NULL CHECK (outcome IN ('SUCCEEDED','FAILED','TIMEOUT','REFUSED','CANCELLED')),
    error_class  TEXT,
    failure_class TEXT,
    steps_used   INTEGER NOT NULL DEFAULT 0,
    tool_calls_used INTEGER NOT NULL DEFAULT 0,
    recorded_at  DOUBLE PRECISION NOT NULL,
    -- One receipt per task attempt: a retried INSERT (same task + attempt)
    -- is a no-op, so a concurrent or repeated append can never duplicate.
    CONSTRAINT hermes_receipts_task_attempt UNIQUE (task_id, attempt)
);

-- Receipt listing per task (the task read-model joins by task_id).
CREATE INDEX IF NOT EXISTS hermes_receipts_task_idx
    ON intelligence.hermes_receipts (task_id, recorded_at);

-- Backfill receipts that were persisted under the JSONB-only model. The
-- recorded_at timestamp did not exist before migration 006; finished_at is
-- the best available ordering key. ON CONFLICT keeps re-runs idempotent.
INSERT INTO intelligence.hermes_receipts (
    receipt_id, task_id, submitted_by, attempt, worker_id, trace_id,
    started_at, finished_at, outcome, error_class, failure_class,
    steps_used, tool_calls_used, recorded_at
)
SELECT
    'rcpt-' || t.task_id || '-' || r.attempt,
    t.task_id,
    t.submitted_by,
    r.attempt,
    COALESCE(r.worker_id, ''),
    COALESCE(r.trace_id, ''),
    r.started_at,
    r.finished_at,
    r.outcome,
    r.error_class,
    r.failure_class,
    COALESCE(r.steps_used, 0),
    COALESCE(r.tool_calls_used, 0),
    COALESCE(r.finished_at, r.started_at, t.created_at)
FROM intelligence.hermes_tasks t
CROSS JOIN LATERAL jsonb_to_recordset(t.receipts) AS r (
    attempt SMALLINT, worker_id TEXT, trace_id TEXT,
    started_at DOUBLE PRECISION, finished_at DOUBLE PRECISION,
    outcome TEXT, error_class TEXT, failure_class TEXT,
    steps_used INTEGER, tool_calls_used INTEGER
)
WHERE r.attempt BETWEEN 1 AND 5
ON CONFLICT (task_id, attempt) DO NOTHING;

-- Row-level security mirrors migration 003/005 for the new table: owner
-- policies on the mirrored submitted_by column, admin membership policy,
-- and FORCE so even the table-owning role is subject to them.
ALTER TABLE intelligence.hermes_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hermes_receipts_owner_access ON intelligence.hermes_receipts;
CREATE POLICY hermes_receipts_owner_access ON intelligence.hermes_receipts
    USING (submitted_by = current_setting('intelligence.owner', true))
    WITH CHECK (submitted_by = current_setting('intelligence.owner', true));

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'intelligence_admin') THEN
        CREATE ROLE intelligence_admin NOLOGIN;
    END IF;
END
$$;

DROP POLICY IF EXISTS hermes_receipts_admin_access ON intelligence.hermes_receipts;
CREATE POLICY hermes_receipts_admin_access ON intelligence.hermes_receipts
    USING (pg_has_role(current_user, 'intelligence_admin', 'member'))
    WITH CHECK (pg_has_role(current_user, 'intelligence_admin', 'member'));

-- Append-only at the database layer for the scoped app role (audit-grade):
-- receipts may be read and inserted, never edited or erased by the app.
GRANT SELECT, INSERT ON intelligence.hermes_receipts TO intelligence_app;
GRANT SELECT, INSERT, DELETE ON intelligence.hermes_receipts TO intelligence_worker;

ALTER TABLE intelligence.hermes_receipts FORCE ROW LEVEL SECURITY;
