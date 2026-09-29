-- ============================================================
-- Comprehensive Feature Fixes Migration
-- Adds: task notes, flags, helpers, activate/deactivate, 
--       audit log, device tracking, discrepancy reports,
--       extended recurring types, multiple reminders,
--       carry-forward, user edit/delete support
-- ============================================================

-- 1. Task enhancements: notes, flags, helpers, active status, carry-forward
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS is_flagged BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS flag_reason TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS helper_user_ids UUID[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS deactivated_until DATE,
  ADD COLUMN IF NOT EXISTS carried_forward_from DATE,
  ADD COLUMN IF NOT EXISTS last_renewed_date DATE,
  ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reminder_times INTEGER[] DEFAULT '{}';

-- Extend recurring enum values (add as text since it's varchar)
-- recurring column is text/varchar so we just allow new values via app

-- 2. User audit log table
CREATE TABLE IF NOT EXISTS public.user_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user_id UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  performed_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  old_values JSONB,
  new_values JSONB,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Client discrepancy reports
CREATE TABLE IF NOT EXISTS public.client_discrepancy_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reported_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  client_org_id UUID REFERENCES public.client_organisations(id) ON DELETE SET NULL,
  client_name TEXT NOT NULL DEFAULT '',
  discrepancy_type TEXT NOT NULL DEFAULT 'general',
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'resolved', 'closed')),
  assigned_to UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  resolution_notes TEXT DEFAULT '',
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Device tracking for location
ALTER TABLE public.employee_locations
  ADD COLUMN IF NOT EXISTS device_name TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS device_type TEXT DEFAULT 'unknown' CHECK (device_type IN ('mobile', 'desktop', 'tablet', 'unknown'));

-- 5. Company holidays table (if not exists)
CREATE TABLE IF NOT EXISTS public.company_holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  holiday_date DATE NOT NULL,
  holiday_type TEXT DEFAULT 'public',
  is_recurring BOOLEAN DEFAULT FALSE,
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Task notes/comments table (for anyone to add notes on tasks)
CREATE TABLE IF NOT EXISTS public.task_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES public.tasks(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  user_name TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- RLS Policies
-- ============================================================

-- User audit log
ALTER TABLE public.user_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "audit_log_read" ON public.user_audit_log;
DROP POLICY IF EXISTS "audit_log_insert" ON public.user_audit_log;
CREATE POLICY "audit_log_read" ON public.user_audit_log
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role IN ('director', 'manager', 'executive')
    )
  );
CREATE POLICY "audit_log_insert" ON public.user_audit_log
  FOR INSERT WITH CHECK (true);

-- Client discrepancy reports
ALTER TABLE public.client_discrepancy_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "discrepancy_select" ON public.client_discrepancy_reports;
DROP POLICY IF EXISTS "discrepancy_insert" ON public.client_discrepancy_reports;
DROP POLICY IF EXISTS "discrepancy_update" ON public.client_discrepancy_reports;
CREATE POLICY "discrepancy_select" ON public.client_discrepancy_reports
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "discrepancy_insert" ON public.client_discrepancy_reports
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "discrepancy_update" ON public.client_discrepancy_reports
  FOR UPDATE USING (auth.uid() IS NOT NULL);

-- Task notes
ALTER TABLE public.task_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "task_notes_select" ON public.task_notes;
DROP POLICY IF EXISTS "task_notes_insert" ON public.task_notes;
DROP POLICY IF EXISTS "task_notes_update" ON public.task_notes;
DROP POLICY IF EXISTS "task_notes_delete" ON public.task_notes;
CREATE POLICY "task_notes_select" ON public.task_notes
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "task_notes_insert" ON public.task_notes
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "task_notes_update" ON public.task_notes
  FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "task_notes_delete" ON public.task_notes
  FOR DELETE USING (
    user_id = auth.uid() OR
    EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role IN ('director', 'manager'))
  );

-- Company holidays
ALTER TABLE public.company_holidays ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "holidays_select" ON public.company_holidays;
DROP POLICY IF EXISTS "holidays_insert" ON public.company_holidays;
DROP POLICY IF EXISTS "holidays_delete" ON public.company_holidays;
CREATE POLICY "holidays_select" ON public.company_holidays
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "holidays_insert" ON public.company_holidays
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role IN ('director', 'manager', 'executive'))
  );
CREATE POLICY "holidays_delete" ON public.company_holidays
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role IN ('director', 'manager', 'executive'))
  );

-- Tasks: allow all authenticated users to insert/update
DROP POLICY IF EXISTS "tasks_all_auth" ON public.tasks;
CREATE POLICY "tasks_all_auth" ON public.tasks
  FOR ALL USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_task_notes_task_id ON public.task_notes(task_id);
CREATE INDEX IF NOT EXISTS idx_user_audit_log_target ON public.user_audit_log(target_user_id);
CREATE INDEX IF NOT EXISTS idx_discrepancy_reports_org ON public.client_discrepancy_reports(client_org_id);
CREATE INDEX IF NOT EXISTS idx_employee_locations_device ON public.employee_locations(device_type);
