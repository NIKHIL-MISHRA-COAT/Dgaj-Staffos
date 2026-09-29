-- Employee Locations Migration
-- Stores live GPS location captured at clock-in/clock-out
-- Timestamp: 20260418400000

-- 1. Employee Locations Table
CREATE TABLE IF NOT EXISTS public.employee_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  accuracy DOUBLE PRECISION DEFAULT NULL,
  recorded_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  event_type TEXT NOT NULL DEFAULT 'clock_in', -- 'clock_in' or 'clock_out'
  is_active BOOLEAN DEFAULT true
);

-- 2. Indexes
CREATE INDEX IF NOT EXISTS idx_employee_locations_user_id ON public.employee_locations(user_id);
CREATE INDEX IF NOT EXISTS idx_employee_locations_recorded_at ON public.employee_locations(recorded_at);
CREATE INDEX IF NOT EXISTS idx_employee_locations_active ON public.employee_locations(is_active);

-- 3. Enable RLS
ALTER TABLE public.employee_locations ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies
-- Employees can insert their own location
DROP POLICY IF EXISTS "employees_insert_own_location" ON public.employee_locations;
CREATE POLICY "employees_insert_own_location"
  ON public.employee_locations FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Employees can update their own location records
DROP POLICY IF EXISTS "employees_update_own_location" ON public.employee_locations;
CREATE POLICY "employees_update_own_location"
  ON public.employee_locations FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Managers and directors can view all locations; employees view only their own
DROP POLICY IF EXISTS "location_select_policy" ON public.employee_locations;
CREATE POLICY "location_select_policy"
  ON public.employee_locations FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_manager_or_director());
