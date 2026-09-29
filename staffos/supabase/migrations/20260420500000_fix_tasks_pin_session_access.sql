-- Fix: Allow PIN-session (anon) users to access tasks
-- PIN-session users are not Supabase-authenticated (auth.uid() = null)
-- so we need anon-role policies for tasks, user_profiles, task_categories, client_organisations

-- ============================================================
-- tasks: allow anon read + write (PIN-session employees/directors)
-- ============================================================
DROP POLICY IF EXISTS "tasks_anon_select" ON public.tasks;
CREATE POLICY "tasks_anon_select" ON public.tasks
  FOR SELECT TO anon
  USING (true);

DROP POLICY IF EXISTS "tasks_anon_insert" ON public.tasks;
CREATE POLICY "tasks_anon_insert" ON public.tasks
  FOR INSERT TO anon
  WITH CHECK (true);

DROP POLICY IF EXISTS "tasks_anon_update" ON public.tasks;
CREATE POLICY "tasks_anon_update" ON public.tasks
  FOR UPDATE TO anon
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "tasks_anon_delete" ON public.tasks;
CREATE POLICY "tasks_anon_delete" ON public.tasks
  FOR DELETE TO anon
  USING (true);

-- ============================================================
-- user_profiles: allow anon read (needed to load user list for assignment)
-- ============================================================
DROP POLICY IF EXISTS "user_profiles_anon_select" ON public.user_profiles;
CREATE POLICY "user_profiles_anon_select" ON public.user_profiles
  FOR SELECT TO anon
  USING (true);

-- ============================================================
-- task_categories: allow anon read (needed to load category filters)
-- ============================================================
DROP POLICY IF EXISTS "task_categories_anon_select" ON public.task_categories;
CREATE POLICY "task_categories_anon_select" ON public.task_categories
  FOR SELECT TO anon
  USING (true);

-- ============================================================
-- client_organisations: allow anon read (needed for client filter)
-- ============================================================
DROP POLICY IF EXISTS "client_organisations_anon_select" ON public.client_organisations;
CREATE POLICY "client_organisations_anon_select" ON public.client_organisations
  FOR SELECT TO anon
  USING (true);
