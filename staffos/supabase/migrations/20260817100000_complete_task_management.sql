-- DGaj Connect: Complete Task Management System
-- Adds task_categories, task_collaborators, task_comments, task_activity,
-- task_subtasks, task_dependencies, task_time_entries, projects
-- Enhances existing tasks table with new fields

-- ── 1. Add projects table ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  client_org_id UUID REFERENCES public.client_organisations(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'on_hold', 'cancelled')),
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── 2. Add task_categories table ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.task_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  color TEXT DEFAULT '#6366f1',
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Patch existing task_categories table (created by earlier migration) with missing columns
ALTER TABLE public.task_categories
  ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

-- ── 3. Enhance tasks table with new columns ───────────────────────────────────
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS creator_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES public.task_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS organisation_id UUID REFERENCES public.client_organisations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS parent_task_id UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS recurrence_id UUID,
  ADD COLUMN IF NOT EXISTS start_date DATE,
  ADD COLUMN IF NOT EXISTS start_time TIME,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS estimated_hours NUMERIC(6,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS actual_hours NUMERIC(6,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS completion_percentage INTEGER DEFAULT 0 CHECK (completion_percentage >= 0 AND completion_percentage <= 100),
  ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS blocker_reason TEXT,
  ADD COLUMN IF NOT EXISTS blocked_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS expected_resolution_date DATE,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS task_status TEXT DEFAULT 'not_started' CHECK (task_status IN ('not_started','in_progress','waiting','blocked','completed','cancelled'));

-- ── 4. task_collaborators ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.task_collaborators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  added_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Patch existing task_collaborators table with missing added_by column
ALTER TABLE public.task_collaborators
  ADD COLUMN IF NOT EXISTS added_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL;

-- Backfill added_by from invited_by if it exists
UPDATE public.task_collaborators SET added_by = invited_by WHERE added_by IS NULL AND invited_by IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_task_collaborators_unique ON public.task_collaborators(task_id, user_id);

-- ── 5. task_comments ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.task_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  comment TEXT NOT NULL,
  mentions UUID[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── 6. task_activity ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.task_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── 7. task_dependencies ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.task_dependencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  dependency_task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  dependency_type TEXT DEFAULT 'blocks' CHECK (dependency_type IN ('blocks','blocked_by','related_to')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_task_dependencies_unique ON public.task_dependencies(task_id, dependency_task_id, dependency_type);

-- ── 8. task_time_entries ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.task_time_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  duration_minutes INTEGER DEFAULT 0,
  description TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── 9. Indexes ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_tasks_creator_id ON public.tasks(creator_id);
CREATE INDEX IF NOT EXISTS idx_tasks_category_id ON public.tasks(category_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON public.tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_organisation_id ON public.tasks(organisation_id);
CREATE INDEX IF NOT EXISTS idx_tasks_task_status ON public.tasks(task_status);
CREATE INDEX IF NOT EXISTS idx_tasks_is_blocked ON public.tasks(is_blocked);
CREATE INDEX IF NOT EXISTS idx_tasks_is_recurring ON public.tasks(is_recurring);
CREATE INDEX IF NOT EXISTS idx_tasks_start_date ON public.tasks(start_date);
CREATE INDEX IF NOT EXISTS idx_task_collaborators_task_id ON public.task_collaborators(task_id);
CREATE INDEX IF NOT EXISTS idx_task_collaborators_user_id ON public.task_collaborators(user_id);
CREATE INDEX IF NOT EXISTS idx_task_comments_task_id ON public.task_comments(task_id);
CREATE INDEX IF NOT EXISTS idx_task_activity_task_id ON public.task_activity(task_id);
CREATE INDEX IF NOT EXISTS idx_task_activity_user_id ON public.task_activity(user_id);
CREATE INDEX IF NOT EXISTS idx_task_time_entries_task_id ON public.task_time_entries(task_id);
CREATE INDEX IF NOT EXISTS idx_task_time_entries_user_id ON public.task_time_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_client_org_id ON public.projects(client_org_id);
CREATE INDEX IF NOT EXISTS idx_projects_created_by ON public.projects(created_by);
CREATE INDEX IF NOT EXISTS idx_task_categories_is_active ON public.task_categories(is_active);

-- ── 10. Enable RLS ────────────────────────────────────────────────────────────
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_collaborators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_time_entries ENABLE ROW LEVEL SECURITY;

-- ── 11. RLS Policies ──────────────────────────────────────────────────────────

-- projects
DROP POLICY IF EXISTS "projects_select" ON public.projects;
CREATE POLICY "projects_select" ON public.projects
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "projects_insert" ON public.projects;
CREATE POLICY "projects_insert" ON public.projects
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "projects_update" ON public.projects;
CREATE POLICY "projects_update" ON public.projects
  FOR UPDATE TO authenticated
  USING (
    created_by = auth.uid()
    OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role::text IN ('director','manager','executive'))
  )
  WITH CHECK (
    created_by = auth.uid()
    OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role::text IN ('director','manager','executive'))
  );

DROP POLICY IF EXISTS "projects_delete" ON public.projects;
CREATE POLICY "projects_delete" ON public.projects
  FOR DELETE TO authenticated
  USING (
    created_by = auth.uid()
    OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role::text IN ('director','manager'))
  );

-- task_categories
DROP POLICY IF EXISTS "task_categories_select" ON public.task_categories;
CREATE POLICY "task_categories_select" ON public.task_categories
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "task_categories_insert" ON public.task_categories;
CREATE POLICY "task_categories_insert" ON public.task_categories
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role::text IN ('director','manager','executive'))
  );

DROP POLICY IF EXISTS "task_categories_update" ON public.task_categories;
CREATE POLICY "task_categories_update" ON public.task_categories
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role::text IN ('director','manager','executive'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role::text IN ('director','manager','executive'))
  );

-- task_collaborators
DROP POLICY IF EXISTS "task_collaborators_select" ON public.task_collaborators;
CREATE POLICY "task_collaborators_select" ON public.task_collaborators
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "task_collaborators_insert" ON public.task_collaborators;
CREATE POLICY "task_collaborators_insert" ON public.task_collaborators
  FOR INSERT TO authenticated
  WITH CHECK (added_by = auth.uid());

DROP POLICY IF EXISTS "task_collaborators_delete" ON public.task_collaborators;
CREATE POLICY "task_collaborators_delete" ON public.task_collaborators
  FOR DELETE TO authenticated
  USING (
    added_by = auth.uid()
    OR user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role::text IN ('director','manager'))
  );

-- task_comments
DROP POLICY IF EXISTS "task_comments_select" ON public.task_comments;
CREATE POLICY "task_comments_select" ON public.task_comments
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "task_comments_insert" ON public.task_comments;
CREATE POLICY "task_comments_insert" ON public.task_comments
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "task_comments_update" ON public.task_comments;
CREATE POLICY "task_comments_update" ON public.task_comments
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "task_comments_delete" ON public.task_comments;
CREATE POLICY "task_comments_delete" ON public.task_comments
  FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role::text IN ('director','manager'))
  );

-- task_activity
DROP POLICY IF EXISTS "task_activity_select" ON public.task_activity;
CREATE POLICY "task_activity_select" ON public.task_activity
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "task_activity_insert" ON public.task_activity;
CREATE POLICY "task_activity_insert" ON public.task_activity
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- task_dependencies
DROP POLICY IF EXISTS "task_dependencies_select" ON public.task_dependencies;
CREATE POLICY "task_dependencies_select" ON public.task_dependencies
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "task_dependencies_insert" ON public.task_dependencies;
CREATE POLICY "task_dependencies_insert" ON public.task_dependencies
  FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "task_dependencies_delete" ON public.task_dependencies;
CREATE POLICY "task_dependencies_delete" ON public.task_dependencies
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role::text IN ('director','manager'))
    OR EXISTS (SELECT 1 FROM public.tasks WHERE id = task_id AND (assigned_to = auth.uid() OR assigned_by = auth.uid() OR creator_id = auth.uid()))
  );

-- task_time_entries
DROP POLICY IF EXISTS "task_time_entries_select" ON public.task_time_entries;
CREATE POLICY "task_time_entries_select" ON public.task_time_entries
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role::text IN ('director','manager','executive'))
  );

DROP POLICY IF EXISTS "task_time_entries_insert" ON public.task_time_entries;
CREATE POLICY "task_time_entries_insert" ON public.task_time_entries
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "task_time_entries_update" ON public.task_time_entries;
CREATE POLICY "task_time_entries_update" ON public.task_time_entries
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ── 12. Triggers ──────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS update_projects_updated_at ON public.projects;
CREATE TRIGGER update_projects_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS update_task_categories_updated_at ON public.task_categories;
CREATE TRIGGER update_task_categories_updated_at
  BEFORE UPDATE ON public.task_categories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS update_task_comments_updated_at ON public.task_comments;
CREATE TRIGGER update_task_comments_updated_at
  BEFORE UPDATE ON public.task_comments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ── 13. Seed default categories ───────────────────────────────────────────────
DO $$
DECLARE
  v_creator UUID;
BEGIN
  SELECT id INTO v_creator FROM public.user_profiles WHERE role::text = 'director' LIMIT 1;
  IF v_creator IS NULL THEN
    SELECT id INTO v_creator FROM public.user_profiles LIMIT 1;
  END IF;

  INSERT INTO public.task_categories (name, slug, description, color, is_active, created_by) VALUES
    ('Administration',  'administration',  'Administrative tasks',          '#6366f1', true, v_creator),
    ('Client Work',     'client-work',     'Client-facing work',            '#3b82f6', true, v_creator),
    ('Sales',           'sales',           'Sales activities',              '#10b981', true, v_creator),
    ('Operations',      'operations',      'Operational tasks',             '#f59e0b', true, v_creator),
    ('Finance',         'finance',         'Finance and accounting',        '#ef4444', true, v_creator),
    ('Reporting',       'reporting',       'Reports and analytics',         '#8b5cf6', true, v_creator),
    ('Marketing',       'marketing',       'Marketing activities',          '#ec4899', true, v_creator),
    ('Internal',        'internal',        'Internal team tasks',           '#64748b', true, v_creator),
    ('Follow-up',       'follow-up',       'Follow-up actions',             '#f97316', true, v_creator),
    ('Compliance',      'compliance',      'Compliance and regulatory',     '#dc2626', true, v_creator),
    ('Meetings',        'meetings',        'Meeting preparation/follow-up', '#0ea5e9', true, v_creator),
    ('Other',           'other',           'Miscellaneous tasks',           '#94a3b8', true, v_creator)
  ON CONFLICT (slug) DO NOTHING;
END $$;
