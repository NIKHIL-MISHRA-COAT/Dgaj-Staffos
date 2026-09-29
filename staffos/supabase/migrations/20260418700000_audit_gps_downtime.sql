-- Audit & GPS Downtime Migration
-- Timestamp: 20260418700000

-- 1. GPS Downtime Events Table (tracks when GPS was off while clocked in)
CREATE TABLE IF NOT EXISTS public.gps_downtime_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  work_date DATE NOT NULL DEFAULT CURRENT_DATE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  duration_minutes INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Out-of-Radius Events Table (tracks when employee was outside allowed zone)
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

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_gps_downtime_user_date ON public.gps_downtime_events(user_id, work_date);
CREATE INDEX IF NOT EXISTS idx_gps_downtime_work_date ON public.gps_downtime_events(work_date);
CREATE INDEX IF NOT EXISTS idx_out_of_radius_user_date ON public.out_of_radius_events(user_id, work_date);
CREATE INDEX IF NOT EXISTS idx_out_of_radius_work_date ON public.out_of_radius_events(work_date);

-- 4. Enable RLS
ALTER TABLE public.gps_downtime_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.out_of_radius_events ENABLE ROW LEVEL SECURITY;

-- 5. RLS for gps_downtime_events
DROP POLICY IF EXISTS "gps_downtime_insert" ON public.gps_downtime_events;
CREATE POLICY "gps_downtime_insert"
  ON public.gps_downtime_events FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "gps_downtime_update" ON public.gps_downtime_events;
CREATE POLICY "gps_downtime_update"
  ON public.gps_downtime_events FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "gps_downtime_select" ON public.gps_downtime_events;
CREATE POLICY "gps_downtime_select"
  ON public.gps_downtime_events FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_manager_or_director());

-- 6. RLS for out_of_radius_events
DROP POLICY IF EXISTS "out_of_radius_insert" ON public.out_of_radius_events;
CREATE POLICY "out_of_radius_insert"
  ON public.out_of_radius_events FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "out_of_radius_select" ON public.out_of_radius_events;
CREATE POLICY "out_of_radius_select"
  ON public.out_of_radius_events FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_manager_or_director());
