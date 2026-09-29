-- Consolidated Pending Migrations
-- Ensures location_settings, route_tracking, gps_downtime_events, out_of_radius_events
-- and audit tables exist with correct RLS policies.
-- Safe to run multiple times (idempotent).

-- ─── 1. LOCATION SETTINGS ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.location_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  firm_default BOOLEAN NOT NULL DEFAULT FALSE,
  office_name TEXT NOT NULL DEFAULT 'Office',
  center_latitude DOUBLE PRECISION NOT NULL DEFAULT 0,
  center_longitude DOUBLE PRECISION NOT NULL DEFAULT 0,
  radius_meters INTEGER NOT NULL DEFAULT 200,
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Add firm_default column if it doesn't exist (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'location_settings' AND column_name = 'firm_default'
  ) THEN
    ALTER TABLE public.location_settings ADD COLUMN firm_default BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
END $$;

-- ─── 2. ROUTE TRACKING ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.route_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  accuracy DOUBLE PRECISION DEFAULT NULL,
  recorded_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  work_date DATE NOT NULL DEFAULT CURRENT_DATE
);

-- ─── 3. GPS DOWNTIME EVENTS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.gps_downtime_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  work_date DATE NOT NULL DEFAULT CURRENT_DATE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  duration_minutes INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 4. OUT-OF-RADIUS EVENTS ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.out_of_radius_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  work_date DATE NOT NULL DEFAULT CURRENT_DATE,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  distance_meters DOUBLE PRECISION NOT NULL,
  allowed_radius_meters INTEGER NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 5. AUDIT LOG TABLE ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_table TEXT,
  target_id UUID,
  old_data JSONB,
  new_data JSONB,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 6. INDEXES ──────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_location_settings_user_id ON public.location_settings(user_id);
CREATE INDEX IF NOT EXISTS idx_location_settings_firm_default ON public.location_settings(firm_default);
CREATE INDEX IF NOT EXISTS idx_route_tracking_user_id ON public.route_tracking(user_id);
CREATE INDEX IF NOT EXISTS idx_route_tracking_work_date ON public.route_tracking(work_date);
CREATE INDEX IF NOT EXISTS idx_route_tracking_user_date ON public.route_tracking(user_id, work_date);
CREATE INDEX IF NOT EXISTS idx_gps_downtime_user_date ON public.gps_downtime_events(user_id, work_date);
CREATE INDEX IF NOT EXISTS idx_gps_downtime_work_date ON public.gps_downtime_events(work_date);
CREATE INDEX IF NOT EXISTS idx_out_of_radius_user_date ON public.out_of_radius_events(user_id, work_date);
CREATE INDEX IF NOT EXISTS idx_out_of_radius_work_date ON public.out_of_radius_events(work_date);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON public.audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON public.audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_target ON public.audit_log(target_table, target_id);

-- ─── 7. ENABLE RLS ───────────────────────────────────────────────────────────
ALTER TABLE public.location_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.route_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gps_downtime_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.out_of_radius_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- ─── 8. RLS: location_settings ───────────────────────────────────────────────
DROP POLICY IF EXISTS "location_settings_select" ON public.location_settings;
CREATE POLICY "location_settings_select"
  ON public.location_settings FOR SELECT TO authenticated
  USING (
    firm_default = TRUE
    OR user_id = auth.uid()
    OR public.is_manager_or_director()
  );

DROP POLICY IF EXISTS "location_settings_insert" ON public.location_settings;
CREATE POLICY "location_settings_insert"
  ON public.location_settings FOR INSERT TO authenticated
  WITH CHECK (public.is_manager_or_director());

DROP POLICY IF EXISTS "location_settings_update" ON public.location_settings;
CREATE POLICY "location_settings_update"
  ON public.location_settings FOR UPDATE TO authenticated
  USING (public.is_manager_or_director())
  WITH CHECK (public.is_manager_or_director());

DROP POLICY IF EXISTS "location_settings_delete" ON public.location_settings;
CREATE POLICY "location_settings_delete"
  ON public.location_settings FOR DELETE TO authenticated
  USING (public.is_manager_or_director());

-- ─── 9. RLS: route_tracking ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "route_tracking_insert" ON public.route_tracking;
CREATE POLICY "route_tracking_insert"
  ON public.route_tracking FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "route_tracking_select" ON public.route_tracking;
CREATE POLICY "route_tracking_select"
  ON public.route_tracking FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_manager_or_director());

DROP POLICY IF EXISTS "route_tracking_delete" ON public.route_tracking;
CREATE POLICY "route_tracking_delete"
  ON public.route_tracking FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- ─── 10. RLS: gps_downtime_events ────────────────────────────────────────────
DROP POLICY IF EXISTS "gps_downtime_insert" ON public.gps_downtime_events;
CREATE POLICY "gps_downtime_insert"
  ON public.gps_downtime_events FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "gps_downtime_update" ON public.gps_downtime_events;
CREATE POLICY "gps_downtime_update"
  ON public.gps_downtime_events FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "gps_downtime_select" ON public.gps_downtime_events;
CREATE POLICY "gps_downtime_select"
  ON public.gps_downtime_events FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_manager_or_director());

-- ─── 11. RLS: out_of_radius_events ───────────────────────────────────────────
DROP POLICY IF EXISTS "out_of_radius_insert" ON public.out_of_radius_events;
CREATE POLICY "out_of_radius_insert"
  ON public.out_of_radius_events FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "out_of_radius_select" ON public.out_of_radius_events;
CREATE POLICY "out_of_radius_select"
  ON public.out_of_radius_events FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_manager_or_director());

-- ─── 12. RLS: audit_log ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "audit_log_insert" ON public.audit_log;
CREATE POLICY "audit_log_insert"
  ON public.audit_log FOR INSERT TO authenticated
  WITH CHECK (actor_id = auth.uid());

DROP POLICY IF EXISTS "audit_log_select" ON public.audit_log;
CREATE POLICY "audit_log_select"
  ON public.audit_log FOR SELECT TO authenticated
  USING (public.is_manager_or_director());
