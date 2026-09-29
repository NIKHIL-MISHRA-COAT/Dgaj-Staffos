-- Fix: Allow PIN-session (anon) users to submit leave requests and access leave balances
-- PIN-session users (directors, managers, employees using PIN) are not Supabase-authenticated
-- so we need anon-role policies for leave_requests and leave_balances

-- ============================================================
-- leave_requests: allow anon full access (PIN-session users)
-- ============================================================
DROP POLICY IF EXISTS "leave_requests_anon_select" ON public.leave_requests;
CREATE POLICY "leave_requests_anon_select" ON public.leave_requests
FOR SELECT TO anon
  USING (true);

DROP POLICY IF EXISTS "leave_requests_anon_insert" ON public.leave_requests;
CREATE POLICY "leave_requests_anon_insert" ON public.leave_requests
FOR INSERT TO anon
  WITH CHECK (true);

DROP POLICY IF EXISTS "leave_requests_anon_update" ON public.leave_requests;
CREATE POLICY "leave_requests_anon_update" ON public.leave_requests
FOR UPDATE TO anon
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- leave_balances: allow anon read + upsert (PIN-session users)
-- ============================================================
DROP POLICY IF EXISTS "leave_balances_anon_select" ON public.leave_balances;
CREATE POLICY "leave_balances_anon_select" ON public.leave_balances
FOR SELECT TO anon
  USING (true);

DROP POLICY IF EXISTS "leave_balances_anon_insert" ON public.leave_balances;
CREATE POLICY "leave_balances_anon_insert" ON public.leave_balances
FOR INSERT TO anon
  WITH CHECK (true);

DROP POLICY IF EXISTS "leave_balances_anon_update" ON public.leave_balances;
CREATE POLICY "leave_balances_anon_update" ON public.leave_balances
FOR UPDATE TO anon
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- director_settings: allow anon read (PIN-session users need to read leave quotas)
-- ============================================================
DROP POLICY IF EXISTS "director_settings_anon_select" ON public.director_settings;
CREATE POLICY "director_settings_anon_select" ON public.director_settings
FOR SELECT TO anon
  USING (true);

-- ============================================================
-- user_profiles: allow anon read (PIN-session users need to read profiles for role-based quota)
-- ============================================================
DROP POLICY IF EXISTS "user_profiles_anon_select" ON public.user_profiles;
CREATE POLICY "user_profiles_anon_select" ON public.user_profiles
FOR SELECT TO anon
  USING (true);
