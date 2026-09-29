-- DGaj Connect: Multi-user task assignment support
-- Adds assigned_user_ids array column and updates RLS policies

-- Add multi-user assignment column
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS assigned_user_ids uuid[] DEFAULT '{}';

-- Index for array containment queries
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_user_ids ON public.tasks USING GIN(assigned_user_ids);

-- Update RLS: employees see tasks assigned to them (single or multi), managers/directors see all
DROP POLICY IF EXISTS "tasks_select" ON public.tasks;
CREATE POLICY "tasks_select" ON public.tasks
  FOR SELECT TO authenticated
  USING (
    assigned_to = auth.uid()
    OR assigned_to_user_id = auth.uid()
    OR assigned_by = auth.uid()
    OR (assigned_user_ids IS NOT NULL AND assigned_user_ids @> ARRAY[auth.uid()])
    OR EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid()
      AND role::text IN ('director', 'manager', 'executive')
    )
  );

DROP POLICY IF EXISTS "tasks_update" ON public.tasks;
CREATE POLICY "tasks_update" ON public.tasks
  FOR UPDATE TO authenticated
  USING (
    assigned_to = auth.uid()
    OR assigned_to_user_id = auth.uid()
    OR assigned_by = auth.uid()
    OR (assigned_user_ids IS NOT NULL AND assigned_user_ids @> ARRAY[auth.uid()])
    OR EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid()
      AND role::text IN ('director', 'manager', 'executive')
    )
  )
  WITH CHECK (
    assigned_to = auth.uid()
    OR assigned_to_user_id = auth.uid()
    OR assigned_by = auth.uid()
    OR (assigned_user_ids IS NOT NULL AND assigned_user_ids @> ARRAY[auth.uid()])
    OR EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid()
      AND role::text IN ('director', 'manager', 'executive')
    )
  );
