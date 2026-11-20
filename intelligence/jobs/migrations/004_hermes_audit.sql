-- Mudaala Intelligence — migration 004: durable Hermes audit log.
--
-- Remediation round 2 (reviewer finding 5): the audit trail was process-local
-- (InMemoryAuditLog) by default, so administrative actions vanished on
-- restart. This table makes the audit trail durable: the wired app writes
-- audit entries here whenever HERMES_DATABASE_URL is configured.
--
-- Append-only BY GRANT: the app/worker roles receive SELECT + INSERT only
-- (migration 005). No code path updates or deletes audit rows; the app roles
-- cannot even if a future bug tries. Entries carry who/what/outcome metadata
-- only — never task payload contents (privacy rule, master plan §10).

CREATE TABLE IF NOT EXISTS intelligence.hermes_audit (
    id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ts      DOUBLE PRECISION NOT NULL,          -- epoch seconds (matches task records)
    event   TEXT NOT NULL,                      -- audited event class, e.g. admin_requeue_task
    actor   TEXT,                               -- verified caller id, when applicable
    details JSONB NOT NULL DEFAULT '{}'::jsonb  -- metadata only (task_id, outcome class, ...)
);

CREATE INDEX IF NOT EXISTS hermes_audit_ts_idx ON intelligence.hermes_audit (ts DESC);
CREATE INDEX IF NOT EXISTS hermes_audit_event_idx ON intelligence.hermes_audit (event);
