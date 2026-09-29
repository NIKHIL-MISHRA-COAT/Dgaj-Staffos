-- Fix: Allow PIN-session (anon) users to insert, update, and delete client_organisations
-- PIN-session users are not Supabase-authenticated (auth.uid() = null / anon role)
-- The previous migration (20260420500000) only added anon SELECT; write operations were missing.

-- ============================================================
-- client_organisations: allow anon insert (PIN-session directors/managers)
-- ============================================================
DROP POLICY IF EXISTS "client_organisations_anon_insert" ON public.client_organisations;
CREATE POLICY "client_organisations_anon_insert" ON public.client_organisations
  FOR INSERT TO anon
  WITH CHECK (true);

-- ============================================================
-- client_organisations: allow anon update (PIN-session directors/managers)
-- ============================================================
DROP POLICY IF EXISTS "client_organisations_anon_update" ON public.client_organisations;
CREATE POLICY "client_organisations_anon_update" ON public.client_organisations
  FOR UPDATE TO anon
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- client_organisations: allow anon delete (PIN-session directors/managers)
-- ============================================================
DROP POLICY IF EXISTS "client_organisations_anon_delete" ON public.client_organisations;
CREATE POLICY "client_organisations_anon_delete" ON public.client_organisations
  FOR DELETE TO anon
  USING (true);
