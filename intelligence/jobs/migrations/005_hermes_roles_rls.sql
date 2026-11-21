-- Mudaala Intelligence — migration 005: scoped database roles, grants and
-- enforced row-level security on Hermes tables.
--
-- Remediation round 2 (reviewer findings 1+2): the durable store was not
-- wired into the application, and RLS existed as policies that no
-- application session ever exercised. This migration provisions the roles
-- the wiring depends on, grants them least-privilege access, and FORCEs row
-- level security so even the table-owning role is subject to the policies.
--
-- ROLE MODEL
--   intelligence_app     tenant request path (owner-scoped; sets
--                        `SET LOCAL intelligence.owner` per transaction)
--   intelligence_worker  infrastructure path (claims, recovery, retention).
--                        RLS binds to it too — the OWNER-ACCESS policy does
--                        not apply to it, so it MUST hold intelligence_admin
--                        membership for the admin policy to let it see rows.
--                        That membership is granted BY THE OPERATOR, never
--                        by migrations:
--                            GRANT intelligence_admin TO intelligence_worker;
--   intelligence_admin   created by 003; membership = administrator path.
--
-- Roles are created NOLOGIN: migrations never provision credentials. The
-- operator creates login users per environment and grants them these roles
-- (CREATE USER ... ; GRANT intelligence_app TO ...;).

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

-- Tenant path: everything a task request needs, nothing else. No DELETE
-- (retention is infrastructure), no DDL, no migrations table writes.
GRANT SELECT, INSERT, UPDATE ON intelligence.hermes_tasks TO intelligence_app;
-- Worker path: infrastructure lifecycle including recovery and retention.
GRANT SELECT, INSERT, UPDATE, DELETE ON intelligence.hermes_tasks TO intelligence_worker;
-- Replay protection: consume is INSERT ... ON CONFLICT DO NOTHING; the TTL
-- cleanup needs DELETE. Shared by both roles.
GRANT SELECT, INSERT, DELETE ON intelligence.hermes_nonces TO intelligence_app, intelligence_worker;
-- Audit trail is append-only for the application plane (004).
GRANT SELECT, INSERT ON intelligence.hermes_audit TO intelligence_app, intelligence_worker;
-- Migrations are readable by both (the store verifies the applied set).
GRANT SELECT ON intelligence.migrations TO intelligence_app, intelligence_worker;

-- Enforcement, not just declaration: FORCE makes RLS bind to the TABLE OWNER
-- as well (superusers and roles with BYPASSRLS still bypass — by design, and
-- documented in jobs/README.md). With FORCE, only sessions matching the
-- owner policy (per-transaction owner setting) or the admin policy
-- (intelligence_admin membership) can touch hermes_tasks rows.
ALTER TABLE intelligence.hermes_tasks FORCE ROW LEVEL SECURITY;
