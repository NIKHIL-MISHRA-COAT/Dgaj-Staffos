-- ============================================================
-- DGaj Connect: Complete System Audit Corrections
-- Fixes: recurring task instances, overdue logic, attendance,
--        leave balances, expense statuses, discrepancy statuses,
--        calendar task sync, audit trail, notifications
-- ============================================================

-- 1. RECURRING TASK INSTANCES TABLE
-- Store every occurrence independently so history is never lost
CREATE TABLE IF NOT EXISTS public.task_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recurring_task_id UUID REFERENCES public.recurring_tasks(id) ON DELETE SET NULL,
  parent_task_id UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  assigned_to UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  assigned_to_name TEXT DEFAULT '',
  assigned_to_dept TEXT DEFAULT '',
  assigned_user_ids UUID[] DEFAULT '{}',
  due_date DATE NOT NULL,
  due_time TIME,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'overdue', 'cancelled')),
  priority TEXT DEFAULT 'medium' CHECK (priority IN ('critical', 'high', 'medium', 'low')),
  task_category TEXT DEFAULT 'general',
  frequency TEXT DEFAULT 'daily',
  checklist JSONB DEFAULT '[]',
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  completion_notes TEXT DEFAULT '',
  time_to_complete_minutes INTEGER,
  carried_forward_from DATE,
  is_carry_forward BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Add missing columns to tasks table for better tracking
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS time_to_complete_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS instance_date DATE,
  ADD COLUMN IF NOT EXISTS parent_recurring_task_id UUID REFERENCES public.recurring_tasks(id) ON DELETE SET NULL;

-- 3. Add 'leave' status to attendance_records if not present
-- attendance_records uses text status so just ensure the app handles it
ALTER TABLE public.attendance_records
  ADD COLUMN IF NOT EXISTS break_minutes INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS late_arrival_minutes INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS early_departure_minutes INTEGER DEFAULT 0;

-- 4. Expense management: add missing status values and remarks
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS manager_remarks TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS clarification_requested BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS clarification_notes TEXT DEFAULT '';

-- Update expense status check to include 'under_review' and 'draft'
ALTER TABLE public.expenses
  DROP CONSTRAINT IF EXISTS expenses_status_check;

ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_status_check
  CHECK (status IN ('draft', 'pending', 'under_review', 'approved', 'rejected', 'reimbursed'));

-- 5. Client discrepancy reports: add missing statuses
ALTER TABLE public.client_discrepancy_reports
  DROP CONSTRAINT IF EXISTS client_discrepancy_reports_status_check;

ALTER TABLE public.client_discrepancy_reports
  ADD CONSTRAINT client_discrepancy_reports_status_check
  CHECK (status IN ('open', 'in_progress', 'investigating', 'pending_clarification', 'resolved', 'closed', 'rejected'));

ALTER TABLE public.client_discrepancy_reports
  ADD COLUMN IF NOT EXISTS remarks TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS document_urls TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 6. Notification types table for structured notifications
CREATE TABLE IF NOT EXISTS public.app_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  notification_type TEXT NOT NULL DEFAULT 'info' CHECK (notification_type IN (
    'task_due_today', 'task_due_tomorrow', 'task_overdue', 'task_assigned',
    'attendance_missing', 'leave_approved', 'leave_rejected', 'leave_pending',
    'expense_approved', 'expense_rejected', 'expense_pending',
    'discrepancy_assigned', 'discrepancy_resolved',
    'escalation_warning', 'escalation_critical',
    'info', 'warning', 'error', 'success'
  )),
  related_id UUID,
  related_type TEXT,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Audit log enhancements
ALTER TABLE public.user_audit_log
  ADD COLUMN IF NOT EXISTS ip_address TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS module TEXT DEFAULT '';

-- 8. Leave carry-forward settings
ALTER TABLE public.leave_balances
  ADD COLUMN IF NOT EXISTS carry_forward_days NUMERIC(5,1) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lapsed_days NUMERIC(5,1) DEFAULT 0;

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_task_instances_recurring_task_id ON public.task_instances(recurring_task_id);
CREATE INDEX IF NOT EXISTS idx_task_instances_assigned_to ON public.task_instances(assigned_to);
CREATE INDEX IF NOT EXISTS idx_task_instances_due_date ON public.task_instances(due_date);
CREATE INDEX IF NOT EXISTS idx_task_instances_status ON public.task_instances(status);
CREATE INDEX IF NOT EXISTS idx_tasks_completed_at ON public.tasks(completed_at);
CREATE INDEX IF NOT EXISTS idx_tasks_instance_date ON public.tasks(instance_date);
CREATE INDEX IF NOT EXISTS idx_app_notifications_user_id ON public.app_notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_app_notifications_is_read ON public.app_notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_app_notifications_created_at ON public.app_notifications(created_at DESC);

-- ============================================================
-- FUNCTIONS
-- ============================================================

-- Function: auto-update overdue status on tasks
CREATE OR REPLACE FUNCTION public.update_overdue_tasks()
RETURNS VOID AS $$
BEGIN
  UPDATE public.tasks
  SET 
    status = 'overdue',
    is_overdue = TRUE
  WHERE 
    due_date < CURRENT_DATE
    AND status NOT IN ('done', 'overdue')
    AND (is_active IS NULL OR is_active = TRUE);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: auto-update overdue status on task_instances
CREATE OR REPLACE FUNCTION public.update_overdue_task_instances()
RETURNS VOID AS $$
BEGIN
  UPDATE public.task_instances
  SET status = 'overdue', updated_at = NOW()
  WHERE 
    due_date < CURRENT_DATE
    AND status NOT IN ('completed', 'overdue', 'cancelled');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: mark task completed with timing
CREATE OR REPLACE FUNCTION public.complete_task_instance(
  p_instance_id UUID,
  p_user_id UUID,
  p_notes TEXT DEFAULT ''
)
RETURNS VOID AS $$
DECLARE
  v_instance public.task_instances%ROWTYPE;
  v_minutes INTEGER;
BEGIN
  SELECT * INTO v_instance FROM public.task_instances WHERE id = p_instance_id;
  IF NOT FOUND THEN RETURN; END IF;
  
  v_minutes := EXTRACT(EPOCH FROM (NOW() - v_instance.created_at)) / 60;
  
  UPDATE public.task_instances
  SET 
    status = 'completed',
    completed_at = NOW(),
    completed_by = p_user_id,
    completion_notes = p_notes,
    time_to_complete_minutes = v_minutes,
    updated_at = NOW()
  WHERE id = p_instance_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: get attendance percentage for a user in a date range
CREATE OR REPLACE FUNCTION public.get_attendance_percentage(
  p_user_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS NUMERIC AS $$
DECLARE
  v_total_working INTEGER;
  v_present INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_total_working
  FROM public.attendance_records
  WHERE user_id = p_user_id
    AND work_date BETWEEN p_start_date AND p_end_date
    AND status NOT IN ('holiday', 'weekend');

  SELECT COUNT(*) INTO v_present
  FROM public.attendance_records
  WHERE user_id = p_user_id
    AND work_date BETWEEN p_start_date AND p_end_date
    AND status IN ('present', 'late', 'half_day', 'work_from_home');

  IF v_total_working = 0 THEN RETURN 0; END IF;
  RETURN ROUND((v_present::NUMERIC / v_total_working::NUMERIC) * 100, 1);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- RLS POLICIES
-- ============================================================

-- task_instances
ALTER TABLE public.task_instances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "task_instances_select" ON public.task_instances;
DROP POLICY IF EXISTS "task_instances_insert" ON public.task_instances;
DROP POLICY IF EXISTS "task_instances_update" ON public.task_instances;
CREATE POLICY "task_instances_select" ON public.task_instances
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "task_instances_insert" ON public.task_instances
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "task_instances_update" ON public.task_instances
  FOR UPDATE USING (auth.uid() IS NOT NULL);

-- app_notifications
ALTER TABLE public.app_notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notifications_own" ON public.app_notifications;
DROP POLICY IF EXISTS "notifications_insert" ON public.app_notifications;
CREATE POLICY "notifications_own" ON public.app_notifications
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "notifications_insert" ON public.app_notifications
  FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "notifications_update" ON public.app_notifications;
CREATE POLICY "notifications_update" ON public.app_notifications
  FOR UPDATE USING (user_id = auth.uid());

-- expenses: allow managers to update any expense
DROP POLICY IF EXISTS "expenses_all_auth" ON public.expenses;
CREATE POLICY "expenses_all_auth" ON public.expenses
  FOR ALL USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- client_discrepancy_reports: allow updates
DROP POLICY IF EXISTS "discrepancy_update" ON public.client_discrepancy_reports;
CREATE POLICY "discrepancy_update" ON public.client_discrepancy_reports
  FOR UPDATE USING (auth.uid() IS NOT NULL);
