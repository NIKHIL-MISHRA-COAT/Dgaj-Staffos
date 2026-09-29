-- DGaj Connect: Tasks and Calendar Events Migration

-- Tasks Table
CREATE TABLE IF NOT EXISTS public.tasks (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  description text DEFAULT '',
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('critical', 'high', 'medium', 'low')),
  status text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in-progress', 'review', 'done', 'overdue')),
  due_date date,
  due_time time,
  assigned_to uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  assigned_to_name text DEFAULT '',
  assigned_to_dept text DEFAULT '',
  assigned_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  assigned_by_name text DEFAULT '',
  assigned_by_dept text DEFAULT '',
  checklist jsonb DEFAULT '[]',
  tags text[] DEFAULT '{}',
  recurring text CHECK (recurring IN ('daily', 'weekly', 'monthly')),
  notify_before_minutes integer DEFAULT 30,
  is_overdue boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Calendar Events Table
CREATE TABLE IF NOT EXISTS public.calendar_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  description text DEFAULT '',
  event_date date NOT NULL,
  start_time time,
  end_time time,
  event_type text NOT NULL DEFAULT 'meeting' CHECK (event_type IN ('meeting', 'task', 'reminder', 'holiday', 'review')),
  recurring text NOT NULL DEFAULT 'none' CHECK (recurring IN ('none', 'daily', 'weekly', 'monthly', 'yearly')),
  department text DEFAULT 'All',
  attendees text[] DEFAULT '{}',
  reminder_minutes integer DEFAULT 15,
  created_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON public.tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_by ON public.tasks(assigned_by);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON public.tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON public.tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_calendar_events_date ON public.calendar_events(event_date);
CREATE INDEX IF NOT EXISTS idx_calendar_events_created_by ON public.calendar_events(created_by);

-- Enable RLS
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;

-- Tasks RLS: employees see their own tasks, managers/directors see all
DROP POLICY IF EXISTS "tasks_select" ON public.tasks;
CREATE POLICY "tasks_select" ON public.tasks
  FOR SELECT TO authenticated
  USING (
    assigned_to = auth.uid()
    OR assigned_by = auth.uid()
    OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role::text IN ('director', 'manager', 'executive'))
  );

DROP POLICY IF EXISTS "tasks_insert" ON public.tasks;
CREATE POLICY "tasks_insert" ON public.tasks
  FOR INSERT TO authenticated
  WITH CHECK (
    assigned_by = auth.uid()
    OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role::text IN ('director', 'manager'))
  );

DROP POLICY IF EXISTS "tasks_update" ON public.tasks;
CREATE POLICY "tasks_update" ON public.tasks
  FOR UPDATE TO authenticated
  USING (
    assigned_to = auth.uid()
    OR assigned_by = auth.uid()
    OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role::text IN ('director', 'manager'))
  )
  WITH CHECK (
    assigned_to = auth.uid()
    OR assigned_by = auth.uid()
    OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role::text IN ('director', 'manager'))
  );

DROP POLICY IF EXISTS "tasks_delete" ON public.tasks;
CREATE POLICY "tasks_delete" ON public.tasks
  FOR DELETE TO authenticated
  USING (
    assigned_by = auth.uid()
    OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role::text IN ('director', 'manager'))
  );

-- Calendar Events RLS: all authenticated users can read, managers/directors can write
DROP POLICY IF EXISTS "calendar_events_select" ON public.calendar_events;
CREATE POLICY "calendar_events_select" ON public.calendar_events
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "calendar_events_insert" ON public.calendar_events;
CREATE POLICY "calendar_events_insert" ON public.calendar_events
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role::text IN ('director', 'manager'))
  );

DROP POLICY IF EXISTS "calendar_events_update" ON public.calendar_events;
CREATE POLICY "calendar_events_update" ON public.calendar_events
  FOR UPDATE TO authenticated
  USING (
    created_by = auth.uid()
    OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role::text IN ('director', 'manager'))
  )
  WITH CHECK (
    created_by = auth.uid()
    OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role::text IN ('director', 'manager'))
  );

DROP POLICY IF EXISTS "calendar_events_delete" ON public.calendar_events;
CREATE POLICY "calendar_events_delete" ON public.calendar_events
  FOR DELETE TO authenticated
  USING (
    created_by = auth.uid()
    OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role::text IN ('director', 'manager'))
  );

-- Updated_at triggers
DROP TRIGGER IF EXISTS update_tasks_updated_at ON public.tasks;
CREATE TRIGGER update_tasks_updated_at
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS update_calendar_events_updated_at ON public.calendar_events;
CREATE TRIGGER update_calendar_events_updated_at
  BEFORE UPDATE ON public.calendar_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
