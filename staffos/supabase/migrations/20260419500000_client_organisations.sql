-- DGaj Connect: Client Organisations
-- Adds client_organisations table and client_org_id column on tasks

-- 1. Create client_organisations table
CREATE TABLE IF NOT EXISTS public.client_organisations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  contact_person TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  notes TEXT,
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 2. Add client_org_id to tasks
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS client_org_id UUID REFERENCES public.client_organisations(id) ON DELETE SET NULL;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS client_org_name TEXT;

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_client_organisations_created_by ON public.client_organisations(created_by);
CREATE INDEX IF NOT EXISTS idx_tasks_client_org_id ON public.tasks(client_org_id);

-- 4. Enable RLS
ALTER TABLE public.client_organisations ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies — directors/managers can manage, all authenticated can read
DROP POLICY IF EXISTS "client_orgs_select" ON public.client_organisations;
CREATE POLICY "client_orgs_select" ON public.client_organisations
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "client_orgs_insert" ON public.client_organisations;
CREATE POLICY "client_orgs_insert" ON public.client_organisations
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid()
      AND role::text IN ('director', 'manager', 'executive')
    )
  );

DROP POLICY IF EXISTS "client_orgs_update" ON public.client_organisations;
CREATE POLICY "client_orgs_update" ON public.client_organisations
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

DROP POLICY IF EXISTS "client_orgs_delete" ON public.client_organisations;
CREATE POLICY "client_orgs_delete" ON public.client_organisations
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid()
      AND role::text IN ('director', 'manager', 'executive')
    )
  );
