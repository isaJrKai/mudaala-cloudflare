-- Business records are private seller data. The Worker uses the restricted
-- mudaala_runtime role; direct Supabase Data API roles must never read or write them.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mudaala_runtime') THEN
    RAISE EXCEPTION 'mudaala_runtime role must exist before business-record RLS is applied';
  END IF;
END
$$;

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['BusinessProduct', 'Sale', 'SaleItem', 'StockMovement'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY deny_direct_api_clients ON public.%I FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
      table_name
    );
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO mudaala_runtime', table_name);
    EXECUTE format(
      'CREATE POLICY mudaala_runtime_access ON public.%I FOR ALL TO mudaala_runtime USING (true) WITH CHECK (true)',
      table_name
    );
  END LOOP;
END
$$;
