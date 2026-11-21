-- Mudaala Intelligence — migration 003: row-level security on Hermes tasks.
--
-- Defense in depth on top of owner-scoped store queries: even a buggy query
-- cannot cross the tenant boundary when RLS is enabled and the application
-- connects as the scoped app role. The app identity sets
-- `SET LOCAL intelligence.owner = '<verified caller id>'` per transaction;
-- the policy compares it to submitted_by.
--
-- NOTE ON DEPLOYMENT: RLS binds to the database role that owns the session.
-- The intelligence app role is created here WITHOUT login (no password is
-- provisioned by migrations — an operator grants access per environment).
-- When Hermes connects as a superuser or table owner, RLS is bypassed BY
-- DESIGN (BYPASSRLS / owner semantics) — deployments must connect as the
-- app role for the boundary to hold. Documented in jobs/README.md.

ALTER TABLE intelligence.hermes_tasks ENABLE ROW LEVEL SECURITY;

-- Owner access: rows where the session-scoped owner setting matches.
DROP POLICY IF EXISTS hermes_tasks_owner_access ON intelligence.hermes_tasks;
CREATE POLICY hermes_tasks_owner_access ON intelligence.hermes_tasks
    USING (submitted_by = current_setting('intelligence.owner', true))
    WITH CHECK (submitted_by = current_setting('intelligence.owner', true));

-- Administrator access: a separately-provisioned admin role is a MEMBER of
-- the intelligence_admin role (granted by the operator, never by migrations
-- with credentials). The policy is inert until that role exists and the
-- session is authenticated as it.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'intelligence_admin') THEN
        CREATE ROLE intelligence_admin NOLOGIN;
    END IF;
END
$$;

DROP POLICY IF EXISTS hermes_tasks_admin_access ON intelligence.hermes_tasks;
CREATE POLICY hermes_tasks_admin_access ON intelligence.hermes_tasks
    USING (pg_has_role(current_user, 'intelligence_admin', 'member'))
    WITH CHECK (pg_has_role(current_user, 'intelligence_admin', 'member'));

-- The nonces table carries no tenant data beyond the caller id it is keyed
-- by; owner policies are not applicable.
