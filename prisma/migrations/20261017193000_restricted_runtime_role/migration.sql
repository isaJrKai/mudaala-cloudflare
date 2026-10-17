-- Give the Worker a non-privileged runtime role, separate from Supabase's postgres owner.
-- This role starts NOLOGIN; the production credential cutover is a separate, reversible
-- operational step after this migration has been applied and verified.
DO $
DECLARE
  existing_role record;
BEGIN
  SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
    INTO existing_role
    FROM pg_roles
    WHERE rolname = 'mudaala_runtime';

  IF NOT FOUND THEN
    CREATE ROLE mudaala_runtime
      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  ELSIF existing_role.rolsuper
     OR existing_role.rolcreatedb
     OR existing_role.rolcreaterole
     OR existing_role.rolreplication
     OR existing_role.rolbypassrls THEN
    RAISE EXCEPTION 'Existing mudaala_runtime role has elevated privileges; refusing to change it automatically';
  END IF;
END
$;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO mudaala_runtime', current_database());
END
$$;

GRANT USAGE ON SCHEMA public TO mudaala_runtime;

-- Runtime code performs authorization in the API layer. This role is not the
-- table owner and cannot bypass RLS. The allow policy lets the application
-- operate while the separate anon/authenticated deny policies remain in force.
-- Do not treat this as per-user row isolation: ownership checks remain mandatory
-- in the application until request-scoped database identity is implemented.
DO $$
DECLARE
  tbl record;
BEGIN
  FOR tbl IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename <> '_prisma_migrations'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl.tablename);
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO mudaala_runtime',
      tbl.tablename
    );

    IF NOT EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = tbl.tablename
        AND policyname = 'mudaala_runtime_access'
        AND 'mudaala_runtime' = ANY(roles)
    ) THEN
      EXECUTE format(
        'CREATE POLICY mudaala_runtime_access ON public.%I FOR ALL TO mudaala_runtime USING (true) WITH CHECK (true)',
        tbl.tablename
      );
    END IF;
  END LOOP;
END
$$;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO mudaala_runtime;

-- Tables/sequences created by the postgres migration owner in future migrations
-- receive runtime privileges automatically; each new table still needs its RLS
-- enabled and a mudaala_runtime_access policy in its own migration.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO mudaala_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO mudaala_runtime;
