-- Defense in depth: deny direct Supabase Data API access to category-interest rows.
-- The Worker uses its trusted PostgreSQL connection and performs account-level authorization.
-- This policy protects the table if direct API privileges are accidentally granted later.
-- Idempotent so an already-present policy does not block migration recovery.

ALTER TABLE public."CategoryInterest" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'CategoryInterest'
      AND policyname = 'deny_direct_api_clients'
  ) THEN
    CREATE POLICY deny_direct_api_clients
      ON public."CategoryInterest"
      FOR ALL
      TO anon, authenticated
      USING (false)
      WITH CHECK (false);
  END IF;
END
$$;
