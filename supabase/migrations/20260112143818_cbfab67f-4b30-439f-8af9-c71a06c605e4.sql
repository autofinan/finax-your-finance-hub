-- Fix search_path for existing functions that were flagged
-- (The new functions already have SET search_path = public)

-- Fix RLS for tables that may be missing it (pre-existing issues)
-- These are likely pre-existing tables without RLS

-- Let's check and enable RLS on any tables that might be missing it
DO $$
DECLARE
  tbl RECORD;
BEGIN
  FOR tbl IN 
    SELECT schemaname, tablename 
    FROM pg_tables 
    WHERE schemaname = 'public' 
    AND tablename NOT IN ('spatial_ref_sys')
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', tbl.schemaname, tbl.tablename);
  END LOOP;
END $$;