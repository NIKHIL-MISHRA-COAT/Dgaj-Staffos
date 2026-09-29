-- DGaj Connect: enable real-time streaming for calendar + location tables
-- Safe to run multiple times. Adds tables to the `supabase_realtime` publication
-- only if they are not already members (Supabase creates this publication by
-- default; some tables may not be attached yet).

DO $$
DECLARE
  tbl TEXT;
  tables TEXT[] := ARRAY[
    'calendar_events',
    'tasks',
    'leave_requests',
    'company_holidays',
    'employee_locations',
    'location_alerts',
    'recurring_tasks',
    'recurring_task_instances'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = tbl
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', tbl);
    END IF;
  END LOOP;
END $$;

-- REPLICA IDENTITY FULL so UPDATE/DELETE realtime payloads include the
-- previous row values (needed to diff old vs new location/alert state).
ALTER TABLE IF EXISTS public.employee_locations REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS public.location_alerts REPLICA IDENTITY FULL;
