-- Location Alerts: tracks when employees turn off location while clocked in
CREATE TABLE IF NOT EXISTS public.location_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL DEFAULT 'location_off',
  message TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_location_alerts_user_id ON public.location_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_location_alerts_created_at ON public.location_alerts(created_at DESC);

-- RLS
ALTER TABLE public.location_alerts ENABLE ROW LEVEL SECURITY;

-- Employees can insert their own alerts
CREATE POLICY "employees_insert_own_alerts"
  ON public.location_alerts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Directors/managers can read all alerts
CREATE POLICY "managers_read_all_alerts"
  ON public.location_alerts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid()
        AND role IN ('director', 'manager', 'executive')
    )
    OR auth.uid() = user_id
  );

-- Allow update (resolve) by managers/directors
CREATE POLICY "managers_update_alerts"
  ON public.location_alerts FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid()
        AND role IN ('director', 'manager', 'executive')
    )
  );
