-- Mudaala uses its own phone/password + server-side session system.
-- Browser clients must not access application tables directly through Supabase
-- Data API. The Worker uses a trusted PostgreSQL connection; these policies
-- deliberately deny Data API roles and do not grant them table privileges.
-- Keep this as defense-in-depth if privileges are accidentally granted later.
--
-- Idempotent so this can be safely applied once to production and later tracked
-- by Prisma migrate deploy without failing on an already-created policy.

DO $$
DECLARE
  tbl text;
  policy_name constant text := 'deny_direct_api_clients';
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'AppSetting',
    'AuditLog',
    'BusinessProfile',
    'Listing',
    'Notification',
    'PasswordReset',
    'PriceSnapshot',
    'Report',
    'SavedSearch',
    'Session',
    'ShopFollow',
    'User'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = tbl
        AND policyname = policy_name
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
        policy_name,
        tbl
      );
    END IF;
  END LOOP;
END
$$;
