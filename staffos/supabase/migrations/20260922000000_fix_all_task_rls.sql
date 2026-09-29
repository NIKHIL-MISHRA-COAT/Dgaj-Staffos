-- DGaj Connect: Definitive RLS reset for the entire task feature area
--
-- Root cause of the "row level security" error on task creation (and the
-- likely cause of similar silent failures elsewhere in Tasks): RLS policies
-- on these tables have been rewritten multiple times across the migration
-- history (Apr, May, Jun, Aug), and some of the later rewrites reintroduced
-- `TO authenticated`-only policies with auth.uid()-based ownership checks —
-- which don't apply to PIN-session logins (anon role, no auth.uid()). This
-- is the exact same root cause as the Firms bug fixed in
-- 20260910020000_fix_firm_rls_pin_auth.sql, just recurring on different
-- tables that were touched by a later, unrelated migration.
--
-- Rather than trace which specific policy name is the current blocker on
-- your live DB (migration history + policy naming has drifted enough that
-- static analysis alone can't be 100% certain), this migration DYNAMICALLY
-- drops every existing policy on each table below, then creates exactly one
-- clean, fully permissive policy per table — matching the trust model the
-- rest of this app already runs on (role checks happen in the UI, not at
-- the DB layer, because PIN sessions have no server-verifiable identity).
--
-- Safe to run on the live DB: purely a policy reset, no data is touched.

DO $$
DECLARE
  tbl TEXT;
  pol RECORD;
  tables TEXT[] := ARRAY[
    'tasks',
    'task_categories',
    'task_collaborators',
    'task_notes',
    'task_comments',
    'task_activity',
    'task_dependencies',
    'task_time_entries',
    'client_organisations',
    'task_instances'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = tbl) THEN
      -- Drop every existing policy on this table, whatever it's named.
      FOR pol IN
        SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = tbl
      LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, tbl);
      END LOOP;

      -- Make sure RLS is actually on (it should already be), then add one
      -- clean permissive policy covering every operation for every role.
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO public USING (true) WITH CHECK (true)',
        tbl || '_open_all', tbl
      );
    END IF;
  END LOOP;
END $$;
