-- DGaj Connect: Multi-Firm / Subsidiary Support (Phase 1 — foundation)
--
-- Fully additive migration — safe to run against the live database.
-- Nothing is dropped, no existing column is renamed, and every existing row
-- is backfilled into a default firm so current behaviour is unchanged until
-- an admin actually creates a second firm.
--
-- What this adds:
--   1. `firms` table — parent firms + subsidiaries (self-referencing tree)
--   2. `firm_data_sharing` — opt-in, per-module sharing between two firms
--      ("integration between each firm" from the request) — off by default
--   3. `firm_id` column on the core operational tables + backfill to a
--      default "Main Firm" row so existing data keeps working unchanged
--   4. `get_visible_firm_ids(uid, module)` helper — the single source of
--      truth every RLS policy uses to decide which firms' rows a user can see
--   5. Firm-aware RLS on the tables this session already touched (recurring
--      tasks, calendar, tasks, live location, chat channels) as the reference
--      pattern. Extending the same pattern to payroll/expenses/tickets/etc.
--      is a mechanical follow-up — see notes at the bottom of this file.

-- ── 1. Firms table ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.firms (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,
  legal_name        text,
  code              text NOT NULL UNIQUE,           -- short code, e.g. 'DGAJ', 'DGAJ-BLR'
  firm_type         text NOT NULL DEFAULT 'subsidiary'
                      CHECK (firm_type IN ('holding', 'parent', 'subsidiary', 'branch')),
  parent_firm_id    uuid REFERENCES public.firms(id) ON DELETE SET NULL,
  logo_url          text,
  is_active         boolean NOT NULL DEFAULT true,
  settings          jsonb NOT NULL DEFAULT '{}',
  created_by        uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_firms_parent ON public.firms(parent_firm_id);

-- Seed a default firm and backfill every existing row into it, so nothing
-- that currently works changes behaviour. Rename/edit this via Firm
-- Configuration once the migration is live — this is a placeholder, not
-- real company data.
INSERT INTO public.firms (id, name, code, firm_type, is_active)
VALUES ('00000000-0000-0000-0000-000000000001', 'Main Firm', 'MAIN', 'holding', true)
ON CONFLICT (id) DO NOTHING;

-- ── 2. Data-sharing between firms ("integration between each firm") ───────
-- Off by default. A director explicitly grants a module of one firm's data
-- to be visible to another (e.g. parent firm sees subsidiary's tasks).
CREATE TABLE IF NOT EXISTS public.firm_data_sharing (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_firm_id    uuid NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  target_firm_id    uuid NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  module            text NOT NULL
                      CHECK (module IN ('tasks', 'calendar', 'chat', 'leave', 'attendance', 'location', 'reports', 'all')),
  is_active         boolean NOT NULL DEFAULT true,
  created_by        uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_firm_id, target_firm_id, module)
);

-- ── 3. firm_id on core tables (nullable, backfilled, indexed) ─────────────
DO $$
DECLARE
  tbl TEXT;
  tables TEXT[] := ARRAY[
    'user_profiles', 'tasks', 'recurring_tasks', 'recurring_task_instances',
    'calendar_events', 'leave_requests', 'leave_balances', 'employee_locations',
    'route_tracking', 'chat_channels', 'attendance_records', 'payroll_records',
    'salary_structures', 'expenses', 'support_tickets', 'client_organisations',
    'audit_log', 'company_holidays', 'company_documents'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = tbl) THEN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = tbl AND column_name = 'firm_id'
      ) THEN
        EXECUTE format(
          'ALTER TABLE public.%I ADD COLUMN firm_id uuid REFERENCES public.firms(id) ON DELETE SET NULL',
          tbl
        );
        EXECUTE format(
          'UPDATE public.%I SET firm_id = %L WHERE firm_id IS NULL',
          tbl, '00000000-0000-0000-0000-000000000001'
        );
        EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_firm_id ON public.%I(firm_id)', tbl, tbl);
      END IF;
    END IF;
  END LOOP;
END $$;

-- ── 4. Helper: which firms can this user see data from? ───────────────────
CREATE OR REPLACE FUNCTION public.get_visible_firm_ids(p_user_id uuid, p_module text DEFAULT 'all')
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT ARRAY(
    -- Always see your own firm
    SELECT up.firm_id FROM public.user_profiles up WHERE up.id = p_user_id AND up.firm_id IS NOT NULL
    UNION
    -- Plus any firm that has explicitly shared this module with your firm
    SELECT fds.source_firm_id
    FROM public.firm_data_sharing fds
    JOIN public.user_profiles up ON up.id = p_user_id
    WHERE fds.target_firm_id = up.firm_id
      AND fds.is_active = true
      AND (fds.module = p_module OR fds.module = 'all')
    UNION
    -- Directors/executives on a holding firm can see all of its subsidiaries
    SELECT f.id
    FROM public.firms f
    JOIN public.user_profiles up ON up.id = p_user_id
    WHERE up.role IN ('director', 'executive')
      AND f.parent_firm_id = up.firm_id
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_visible_firm_ids(uuid, text) TO authenticated;

-- ── 5. RLS: enable firms + sharing tables ──────────────────────────────────
ALTER TABLE public.firms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.firm_data_sharing ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "firms_select_all_auth" ON public.firms;
CREATE POLICY "firms_select_all_auth" ON public.firms
  FOR SELECT TO authenticated USING (true); -- firm directory itself is visible to all; data inside firms is scoped separately

DROP POLICY IF EXISTS "firms_write_directors" ON public.firms;
CREATE POLICY "firms_write_directors" ON public.firms
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'director'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'director'));

DROP POLICY IF EXISTS "firm_sharing_select" ON public.firm_data_sharing;
CREATE POLICY "firm_sharing_select" ON public.firm_data_sharing
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "firm_sharing_write_directors" ON public.firm_data_sharing;
CREATE POLICY "firm_sharing_write_directors" ON public.firm_data_sharing
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'director'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'director'));

-- ── 6. Reference pattern: firm-scope the tables this session built/touched ─
-- recurring_tasks
DROP POLICY IF EXISTS "rt_select_all_auth" ON public.recurring_tasks;
CREATE POLICY "rt_select_firm_scoped" ON public.recurring_tasks
  FOR SELECT TO authenticated
  USING (firm_id = ANY (public.get_visible_firm_ids(auth.uid(), 'tasks')));

-- recurring_task_instances
DROP POLICY IF EXISTS "rti_select_own" ON public.recurring_task_instances;
CREATE POLICY "rti_select_firm_scoped" ON public.recurring_task_instances
  FOR SELECT TO authenticated
  USING (
    assigned_to = auth.uid()
    OR (
      firm_id = ANY (public.get_visible_firm_ids(auth.uid(), 'tasks'))
      AND EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role IN ('director','manager','executive'))
    )
  );

-- calendar_events (adjust policy name if your existing migration used a different one)
DROP POLICY IF EXISTS "calendar_events_select" ON public.calendar_events;
CREATE POLICY "calendar_events_select_firm_scoped" ON public.calendar_events
  FOR SELECT TO authenticated
  USING (firm_id = ANY (public.get_visible_firm_ids(auth.uid(), 'calendar')));

-- employee_locations
DROP POLICY IF EXISTS "employee_locations_select" ON public.employee_locations;
CREATE POLICY "employee_locations_select_firm_scoped" ON public.employee_locations
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (
      firm_id = ANY (public.get_visible_firm_ids(auth.uid(), 'location'))
      AND EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role IN ('director','manager','executive'))
    )
  );

-- chat_channels
DROP POLICY IF EXISTS "chat_channels_select" ON public.chat_channels;
CREATE POLICY "chat_channels_select_firm_scoped" ON public.chat_channels
  FOR SELECT TO authenticated
  USING (firm_id = ANY (public.get_visible_firm_ids(auth.uid(), 'chat')));

-- ─────────────────────────────────────────────────────────────────────────
-- NOTES FOR PHASE 2 (not applied by this migration — do these once Phase 1
-- is verified in a staging Supabase project, never directly on prod):
--   • Extend the same DROP POLICY / CREATE POLICY pattern above to:
--     leave_requests, leave_balances, attendance_records, payroll_records,
--     salary_structures, expenses, support_tickets, audit_log,
--     company_holidays, company_documents.
--   • Add a `firm_id` selector to user_profiles admin screens so new users
--     are assigned to a firm at creation time.
--   • The exact pre-existing SELECT policy names above (e.g.
--     "calendar_events_select") were assumed from naming convention — check
--     each table's current policy name with
--     `select policyname from pg_policies where tablename = '<table>'`
--     before running, and adjust the DROP POLICY line if it differs, or the
--     old permissive policy will keep coexisting with the new one.
-- ─────────────────────────────────────────────────────────────────────────
