-- Location Settings & Route Tracking Migration
-- Timestamp: 20260418500000

-- 1. Location Settings Table (per-employee clock-in/out radius)
CREATE TABLE IF NOT EXISTS public.location_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  office_name TEXT NOT NULL DEFAULT 'Office',
  center_latitude DOUBLE PRECISION NOT NULL,
  center_longitude DOUBLE PRECISION NOT NULL,
  radius_meters INTEGER NOT NULL DEFAULT 200,
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id)
);

-- 2. Route Tracking Table (breadcrumb trail throughout the day)
CREATE TABLE IF NOT EXISTS public.route_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  accuracy DOUBLE PRECISION DEFAULT NULL,
  recorded_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  work_date DATE NOT NULL DEFAULT CURRENT_DATE
);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_location_settings_user_id ON public.location_settings(user_id);
CREATE INDEX IF NOT EXISTS idx_route_tracking_user_id ON public.route_tracking(user_id);
CREATE INDEX IF NOT EXISTS idx_route_tracking_work_date ON public.route_tracking(work_date);
CREATE INDEX IF NOT EXISTS idx_route_tracking_user_date ON public.route_tracking(user_id, work_date);

-- 4. Enable RLS
ALTER TABLE public.location_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.route_tracking ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies for location_settings
DROP POLICY IF EXISTS "location_settings_select" ON public.location_settings;
CREATE POLICY "location_settings_select"
  ON public.location_settings FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_manager_or_director());

DROP POLICY IF EXISTS "location_settings_insert" ON public.location_settings;
CREATE POLICY "location_settings_insert"
  ON public.location_settings FOR INSERT
  TO authenticated
  WITH CHECK (public.is_manager_or_director());

DROP POLICY IF EXISTS "location_settings_update" ON public.location_settings;
CREATE POLICY "location_settings_update"
  ON public.location_settings FOR UPDATE
  TO authenticated
  USING (public.is_manager_or_director())
  WITH CHECK (public.is_manager_or_director());

DROP POLICY IF EXISTS "location_settings_delete" ON public.location_settings;
CREATE POLICY "location_settings_delete"
  ON public.location_settings FOR DELETE
  TO authenticated
  USING (public.is_manager_or_director());

-- 6. RLS Policies for route_tracking
DROP POLICY IF EXISTS "route_tracking_insert" ON public.route_tracking;
CREATE POLICY "route_tracking_insert"
  ON public.route_tracking FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "route_tracking_select" ON public.route_tracking;
CREATE POLICY "route_tracking_select"
  ON public.route_tracking FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_manager_or_director());

DROP POLICY IF EXISTS "route_tracking_delete" ON public.route_tracking;
CREATE POLICY "route_tracking_delete"
  ON public.route_tracking FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());
