-- Fix RLS policies for client_discrepancy_reports and tasks to allow PIN session (anon) users
-- Also fix leave balances: paid = 5 per FY, keep medical and substitute

-- ============================================================
-- client_discrepancy_reports: allow anon (PIN session) users
-- ============================================================
DROP POLICY IF EXISTS "anon_discrepancy_select" ON public.client_discrepancy_reports;
DROP POLICY IF EXISTS "anon_discrepancy_insert" ON public.client_discrepancy_reports;
DROP POLICY IF EXISTS "anon_discrepancy_update" ON public.client_discrepancy_reports;

CREATE POLICY "anon_discrepancy_select" ON public.client_discrepancy_reports
  FOR SELECT TO anon
  USING (true);

CREATE POLICY "anon_discrepancy_insert" ON public.client_discrepancy_reports
  FOR INSERT TO anon
  WITH CHECK (true);

CREATE POLICY "anon_discrepancy_update" ON public.client_discrepancy_reports
  FOR UPDATE TO anon
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- tasks: allow anon (PIN session) users to INSERT/UPDATE/SELECT
-- ============================================================
DROP POLICY IF EXISTS "anon_tasks_select" ON public.tasks;
DROP POLICY IF EXISTS "anon_tasks_insert" ON public.tasks;
DROP POLICY IF EXISTS "anon_tasks_update" ON public.tasks;

CREATE POLICY "anon_tasks_select" ON public.tasks
  FOR SELECT TO anon
  USING (true);

CREATE POLICY "anon_tasks_insert" ON public.tasks
  FOR INSERT TO anon
  WITH CHECK (true);

CREATE POLICY "anon_tasks_update" ON public.tasks
  FOR UPDATE TO anon
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- Fix leave_balances: set paid leave quota to 5 per FY
-- Update existing leave_balances rows for 'paid' leave type
-- ============================================================
UPDATE public.leave_balances
SET total_days = 5
WHERE leave_type = 'paid';

-- ============================================================
-- Remove half_day leave balances (no longer used)
-- ============================================================
DELETE FROM public.leave_balances WHERE leave_type = 'half_day';
