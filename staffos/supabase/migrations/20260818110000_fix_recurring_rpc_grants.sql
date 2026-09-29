-- DGaj Connect: Fix recurring task RPC grants
-- Ensures authenticated users can call the generate_recurring_instances RPC
-- and that the recurring_tasks INSERT policy allows executives

-- ── 1. Grant EXECUTE on RPC functions to authenticated users ─────────────────
GRANT EXECUTE ON FUNCTION public.generate_recurring_instances(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_all_recurring_instances(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_overdue_recurring_instances() TO authenticated;

-- ── 2. Ensure recurring_tasks INSERT policy covers executives ─────────────────
-- Drop old restrictive write policy that only covered director/manager
DROP POLICY IF EXISTS "recurring_tasks_write" ON public.recurring_tasks;

-- Recreate as separate INSERT/UPDATE/DELETE so we can be precise
DROP POLICY IF EXISTS "rt_insert_managers" ON public.recurring_tasks;
CREATE POLICY "rt_insert_managers" ON public.recurring_tasks
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid()
        AND role::text IN ('director', 'manager', 'executive')
    )
  );

DROP POLICY IF EXISTS "rt_update_managers" ON public.recurring_tasks;
CREATE POLICY "rt_update_managers" ON public.recurring_tasks
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid()
        AND role::text IN ('director', 'manager', 'executive')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid()
        AND role::text IN ('director', 'manager', 'executive')
    )
  );

DROP POLICY IF EXISTS "rt_delete_directors" ON public.recurring_tasks;
CREATE POLICY "rt_delete_directors" ON public.recurring_tasks
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid()
        AND role::text IN ('director', 'manager', 'executive')
    )
  );

-- ── 3. Ensure recurring_task_instances INSERT policy covers executives ────────
-- Drop old restrictive insert policy
DROP POLICY IF EXISTS "task_instances_insert" ON public.recurring_task_instances;

DROP POLICY IF EXISTS "rti_insert_managers" ON public.recurring_task_instances;
CREATE POLICY "rti_insert_managers" ON public.recurring_task_instances
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid()
        AND role::text IN ('director', 'manager', 'executive')
    )
  );

-- ── 4. Ensure recurring_task_instances UPDATE policy covers executives ────────
DROP POLICY IF EXISTS "task_instances_update" ON public.recurring_task_instances;

DROP POLICY IF EXISTS "rti_update_own" ON public.recurring_task_instances;
CREATE POLICY "rti_update_own" ON public.recurring_task_instances
  FOR UPDATE TO authenticated
  USING (
    assigned_to = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid()
        AND role::text IN ('director', 'manager', 'executive')
    )
  )
  WITH CHECK (
    assigned_to = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid()
        AND role::text IN ('director', 'manager', 'executive')
    )
  );
