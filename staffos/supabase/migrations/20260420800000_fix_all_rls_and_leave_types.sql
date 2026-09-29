-- Fix attendance_records RLS to allow PIN session users to clock in/out
-- Also fix leave_balances, notifications, support_tickets, expenses RLS for PIN users

-- ============================================================
-- Extend leave_type enum with new values (substitute, medical, half_day)
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'substitute'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'leave_type')
  ) THEN
    ALTER TYPE public.leave_type ADD VALUE 'substitute';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'medical'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'leave_type')
  ) THEN
    ALTER TYPE public.leave_type ADD VALUE 'medical';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'half_day'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'leave_type')
  ) THEN
    ALTER TYPE public.leave_type ADD VALUE 'half_day';
  END IF;
END $$;

-- ============================================================
-- attendance_records: allow anon (PIN session) users to INSERT/UPDATE
-- ============================================================
DO $$
BEGIN
  -- Drop existing anon policies if any
  DROP POLICY IF EXISTS "anon_attendance_insert" ON public.attendance_records;
  DROP POLICY IF EXISTS "anon_attendance_update" ON public.attendance_records;
  DROP POLICY IF EXISTS "anon_attendance_select" ON public.attendance_records;
END $$;

CREATE POLICY "anon_attendance_select" ON public.attendance_records
  FOR SELECT TO anon
  USING (true);

CREATE POLICY "anon_attendance_insert" ON public.attendance_records
  FOR INSERT TO anon
  WITH CHECK (true);

CREATE POLICY "anon_attendance_update" ON public.attendance_records
  FOR UPDATE TO anon
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- employee_locations: allow anon users to INSERT/UPDATE
-- ============================================================
DO $$
BEGIN
  DROP POLICY IF EXISTS "anon_locations_insert" ON public.employee_locations;
  DROP POLICY IF EXISTS "anon_locations_update" ON public.employee_locations;
  DROP POLICY IF EXISTS "anon_locations_select" ON public.employee_locations;
END $$;

CREATE POLICY "anon_locations_select" ON public.employee_locations
  FOR SELECT TO anon
  USING (true);

CREATE POLICY "anon_locations_insert" ON public.employee_locations
  FOR INSERT TO anon
  WITH CHECK (true);

CREATE POLICY "anon_locations_update" ON public.employee_locations
  FOR UPDATE TO anon
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- route_tracking: allow anon users to INSERT
-- ============================================================
DO $$
BEGIN
  DROP POLICY IF EXISTS "anon_route_insert" ON public.route_tracking;
  DROP POLICY IF EXISTS "anon_route_select" ON public.route_tracking;
END $$;

CREATE POLICY "anon_route_select" ON public.route_tracking
  FOR SELECT TO anon
  USING (true);

CREATE POLICY "anon_route_insert" ON public.route_tracking
  FOR INSERT TO anon
  WITH CHECK (true);

-- ============================================================
-- out_of_radius_events: allow anon users to INSERT
-- ============================================================
DO $$
BEGIN
  DROP POLICY IF EXISTS "anon_radius_insert" ON public.out_of_radius_events;
END $$;

CREATE POLICY "anon_radius_insert" ON public.out_of_radius_events
  FOR INSERT TO anon
  WITH CHECK (true);

-- ============================================================
-- leave_balances: allow anon users to SELECT
-- ============================================================
DO $$
BEGIN
  DROP POLICY IF EXISTS "anon_leave_balances_select" ON public.leave_balances;
END $$;

CREATE POLICY "anon_leave_balances_select" ON public.leave_balances
  FOR SELECT TO anon
  USING (true);

-- ============================================================
-- leave_requests: allow anon users to SELECT/INSERT
-- ============================================================
DO $$
BEGIN
  DROP POLICY IF EXISTS "anon_leave_requests_select" ON public.leave_requests;
  DROP POLICY IF EXISTS "anon_leave_requests_insert" ON public.leave_requests;
  DROP POLICY IF EXISTS "anon_leave_requests_update" ON public.leave_requests;
END $$;

CREATE POLICY "anon_leave_requests_select" ON public.leave_requests
  FOR SELECT TO anon
  USING (true);

CREATE POLICY "anon_leave_requests_insert" ON public.leave_requests
  FOR INSERT TO anon
  WITH CHECK (true);

CREATE POLICY "anon_leave_requests_update" ON public.leave_requests
  FOR UPDATE TO anon
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- notifications: allow anon users to SELECT/INSERT
-- ============================================================
DO $$
BEGIN
  DROP POLICY IF EXISTS "anon_notifications_select" ON public.notifications;
  DROP POLICY IF EXISTS "anon_notifications_insert" ON public.notifications;
  DROP POLICY IF EXISTS "anon_notifications_update" ON public.notifications;
END $$;

CREATE POLICY "anon_notifications_select" ON public.notifications
  FOR SELECT TO anon
  USING (true);

CREATE POLICY "anon_notifications_insert" ON public.notifications
  FOR INSERT TO anon
  WITH CHECK (true);

CREATE POLICY "anon_notifications_update" ON public.notifications
  FOR UPDATE TO anon
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- support_tickets: allow anon users to SELECT/INSERT/UPDATE
-- ============================================================
DO $$
BEGIN
  DROP POLICY IF EXISTS "anon_tickets_select" ON public.support_tickets;
  DROP POLICY IF EXISTS "anon_tickets_insert" ON public.support_tickets;
  DROP POLICY IF EXISTS "anon_tickets_update" ON public.support_tickets;
END $$;

CREATE POLICY "anon_tickets_select" ON public.support_tickets
  FOR SELECT TO anon
  USING (true);

CREATE POLICY "anon_tickets_insert" ON public.support_tickets
  FOR INSERT TO anon
  WITH CHECK (true);

CREATE POLICY "anon_tickets_update" ON public.support_tickets
  FOR UPDATE TO anon
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- expenses: allow anon users to SELECT/INSERT/UPDATE
-- ============================================================
DO $$
BEGIN
  DROP POLICY IF EXISTS "anon_expenses_select" ON public.expenses;
  DROP POLICY IF EXISTS "anon_expenses_insert" ON public.expenses;
  DROP POLICY IF EXISTS "anon_expenses_update" ON public.expenses;
END $$;

CREATE POLICY "anon_expenses_select" ON public.expenses
  FOR SELECT TO anon
  USING (true);

CREATE POLICY "anon_expenses_insert" ON public.expenses
  FOR INSERT TO anon
  WITH CHECK (true);

CREATE POLICY "anon_expenses_update" ON public.expenses
  FOR UPDATE TO anon
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- location_settings: allow anon users to SELECT
-- ============================================================
DO $$
BEGIN
  DROP POLICY IF EXISTS "anon_location_settings_select" ON public.location_settings;
END $$;

CREATE POLICY "anon_location_settings_select" ON public.location_settings
  FOR SELECT TO anon
  USING (true);

-- ============================================================
-- location_alerts: allow anon users to INSERT
-- ============================================================
DO $$
BEGIN
  DROP POLICY IF EXISTS "anon_location_alerts_insert" ON public.location_alerts;
END $$;

CREATE POLICY "anon_location_alerts_insert" ON public.location_alerts
  FOR INSERT TO anon
  WITH CHECK (true);
