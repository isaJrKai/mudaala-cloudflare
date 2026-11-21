-- Shop tags are written only by the authenticated application API.
-- The Worker connects as mudaala_runtime (a non-BYPASSRLS role), so new
-- tables must explicitly grant that role access through RLS policies.
-- Keep direct Supabase Data API roles denied, matching the existing
-- application-owned table security boundary.

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['ShopTag', 'ShopTagDailyStat'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY deny_direct_api_clients ON public.%I FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
      table_name
    );
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO mudaala_runtime',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY mudaala_runtime_access ON public.%I FOR ALL TO mudaala_runtime USING (true) WITH CHECK (true)',
      table_name
    );
  END LOOP;
END
$$;
