-- Ensure 'executive' exists in user_role enum (safe no-op if already present)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'executive'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'user_role' AND typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public'))
  ) THEN
    ALTER TYPE public.user_role ADD VALUE 'executive';
  END IF;
END;
$$;

-- Director Settings Table
CREATE TABLE IF NOT EXISTS public.director_settings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  setting_key text NOT NULL UNIQUE,
  setting_value jsonb NOT NULL DEFAULT '{}',
  updated_by uuid REFERENCES public.user_profiles(id),
  updated_at timestamptz DEFAULT now()
);

-- Leave Quotas per role
INSERT INTO public.director_settings (setting_key, setting_value) VALUES
  ('leave_quotas', '{"employee": {"casual": 12, "sick": 10, "paid": 15}, "manager": {"casual": 15, "sick": 12, "paid": 18}, "executive": {"casual": 18, "sick": 12, "paid": 20}, "director": {"casual": 20, "sick": 15, "paid": 25}}'),
  ('task_limits', '{"max_concurrent_tasks": 5, "max_overdue_days": 3, "daily_task_limit": 8}'),
  ('overtime_thresholds', '{"daily_overtime_hours": 2, "weekly_overtime_hours": 10, "monthly_overtime_hours": 40}'),
  ('shift_defaults', '{"morning_start": "09:00", "morning_end": "18:00", "evening_start": "14:00", "evening_end": "23:00", "night_start": "22:00", "night_end": "07:00"}'),
  ('public_holidays', '[]')
ON CONFLICT (setting_key) DO NOTHING;

-- Recurring Tasks Table
CREATE TABLE IF NOT EXISTS public.recurring_tasks (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  description text,
  frequency text NOT NULL DEFAULT 'daily' CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  assigned_to_role text[] DEFAULT '{}',
  assigned_to_users uuid[] DEFAULT '{}',
  department text,
  time_limit_minutes integer DEFAULT 60,
  notify_before_minutes integer DEFAULT 30,
  checklist jsonb DEFAULT '[]',
  workflow_steps jsonb DEFAULT '[]',
  is_active boolean DEFAULT true,
  created_by uuid REFERENCES public.user_profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Recurring Task Instances (daily generated)
CREATE TABLE IF NOT EXISTS public.recurring_task_instances (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  recurring_task_id uuid REFERENCES public.recurring_tasks(id) ON DELETE CASCADE,
  assigned_to uuid REFERENCES public.user_profiles(id),
  due_date date NOT NULL,
  due_time time,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'overdue')),
  checklist_progress jsonb DEFAULT '[]',
  completed_at timestamptz,
  notes text,
  created_at timestamptz DEFAULT now()
);

-- RLS Policies
ALTER TABLE public.director_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_task_instances ENABLE ROW LEVEL SECURITY;

-- Director settings: only directors can write, all authenticated can read
CREATE POLICY "director_settings_read" ON public.director_settings
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "director_settings_write" ON public.director_settings
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role::text = 'director')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role::text = 'director')
  );

-- Recurring tasks: directors and managers can create/edit
CREATE POLICY "recurring_tasks_read" ON public.recurring_tasks
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "recurring_tasks_write" ON public.recurring_tasks
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role::text IN ('director', 'manager'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role::text IN ('director', 'manager'))
  );

-- Task instances: assigned user can update, managers/directors can read all
CREATE POLICY "task_instances_read" ON public.recurring_task_instances
  FOR SELECT TO authenticated
  USING (
    assigned_to = auth.uid()
    OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role::text IN ('director', 'manager', 'executive'))
  );

CREATE POLICY "task_instances_update" ON public.recurring_task_instances
  FOR UPDATE TO authenticated
  USING (assigned_to = auth.uid() OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role::text IN ('director', 'manager')));

CREATE POLICY "task_instances_insert" ON public.recurring_task_instances
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role::text IN ('director', 'manager'))
  );
