-- Task Collaboration: Allow all users to create/assign tasks and add collaborators
-- Also adds task_collaborators table for invite-based collaboration

-- ============================================================
-- 1. task_collaborators table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.task_collaborators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  invited_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  invited_by_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'collaborator' CHECK (role IN ('collaborator', 'reviewer', 'observer')),
  status TEXT NOT NULL DEFAULT 'accepted' CHECK (status IN ('pending', 'accepted', 'declined')),
  invited_at TIMESTAMPTZ DEFAULT now(),
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(task_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_task_collaborators_task_id ON public.task_collaborators(task_id);
CREATE INDEX IF NOT EXISTS idx_task_collaborators_user_id ON public.task_collaborators(user_id);

ALTER TABLE public.task_collaborators ENABLE ROW LEVEL SECURITY;

-- RLS: All authenticated and anon users can read/write collaborators
DROP POLICY IF EXISTS "task_collaborators_anon_all" ON public.task_collaborators;
CREATE POLICY "task_collaborators_anon_all" ON public.task_collaborators
  FOR ALL TO anon
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "task_collaborators_auth_all" ON public.task_collaborators;
CREATE POLICY "task_collaborators_auth_all" ON public.task_collaborators
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- 2. Ensure all users (authenticated) can insert/update/delete tasks
-- ============================================================
DROP POLICY IF EXISTS "tasks_auth_select" ON public.tasks;
CREATE POLICY "tasks_auth_select" ON public.tasks
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "tasks_auth_insert" ON public.tasks;
CREATE POLICY "tasks_auth_insert" ON public.tasks
  FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "tasks_auth_update" ON public.tasks;
CREATE POLICY "tasks_auth_update" ON public.tasks
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "tasks_auth_delete" ON public.tasks;
CREATE POLICY "tasks_auth_delete" ON public.tasks
  FOR DELETE TO authenticated
  USING (true);

-- ============================================================
-- 3. Ensure task_notes are accessible to all users (for collaboration)
-- ============================================================
DROP POLICY IF EXISTS "task_notes_anon_all" ON public.task_notes;
CREATE POLICY "task_notes_anon_all" ON public.task_notes
  FOR ALL TO anon
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "task_notes_auth_all" ON public.task_notes;
CREATE POLICY "task_notes_auth_all" ON public.task_notes
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);
