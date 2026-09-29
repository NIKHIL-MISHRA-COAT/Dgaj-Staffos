-- Task Categories table for editable/creatable/deletable categories
CREATE TABLE IF NOT EXISTS public.task_categories (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  color text DEFAULT '#6366f1',
  created_by uuid REFERENCES public.user_profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.task_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "task_categories_read" ON public.task_categories
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "task_categories_write" ON public.task_categories
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role::text IN ('director', 'manager', 'executive'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role::text IN ('director', 'manager', 'executive'))
  );

-- Seed default categories
INSERT INTO public.task_categories (name, slug, color) VALUES
  ('Daily Tasks', 'daily', '#3b82f6'),
  ('Daily Excel', 'daily-excel', '#06b6d4'),
  ('Monthly Tasks', 'monthly', '#f59e0b'),
  ('Monthly Excel', 'monthly-excel', '#f97316'),
  ('General', 'general', '#6366f1')
ON CONFLICT (slug) DO NOTHING;

-- Recurring task spawn log to prevent duplicate daily/monthly spawning
CREATE TABLE IF NOT EXISTS public.recurring_task_spawn_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  recurring_task_id uuid REFERENCES public.recurring_tasks(id) ON DELETE CASCADE,
  spawn_date date NOT NULL,
  spawned_at timestamptz DEFAULT now(),
  UNIQUE(recurring_task_id, spawn_date)
);

ALTER TABLE public.recurring_task_spawn_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "spawn_log_read" ON public.recurring_task_spawn_log
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role::text IN ('director', 'manager', 'executive'))
  );

CREATE POLICY "spawn_log_insert" ON public.recurring_task_spawn_log
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role::text IN ('director', 'manager', 'executive'))
  );
