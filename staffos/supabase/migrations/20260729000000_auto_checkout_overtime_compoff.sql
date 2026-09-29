-- Migration: Auto check-out, overtime requests, comp-off, half-day leave enhancements
-- Timestamp: 20260729000000

-- 1. Add auto_checkout flag to attendance_records
ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS is_auto_checkout BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS auto_checkout_reason TEXT,
  ADD COLUMN IF NOT EXISTS late_arrival BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS early_departure BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS standard_start_time TIME,
  ADD COLUMN IF NOT EXISTS standard_end_time TIME;

-- 2. Create overtime_requests table
CREATE TABLE IF NOT EXISTS overtime_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  work_date DATE NOT NULL,
  overtime_hours NUMERIC(4,2) NOT NULL CHECK (overtime_hours > 0),
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by UUID REFERENCES user_profiles(id),
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  attendance_record_id UUID REFERENCES attendance_records(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Create comp_off_requests table (substitute working days)
CREATE TABLE IF NOT EXISTS comp_off_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  worked_date DATE NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  comp_off_days NUMERIC(3,1) NOT NULL DEFAULT 1.0 CHECK (comp_off_days > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by UUID REFERENCES user_profiles(id),
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  redeemed BOOLEAN NOT NULL DEFAULT FALSE,
  redeemed_on DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Add half_day_type to leave_requests (first_half / second_half)
ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS half_day_type TEXT CHECK (half_day_type IN ('first_half','second_half','full_day')) DEFAULT 'full_day';

-- Update existing half-day records
UPDATE leave_requests
  SET half_day_type = CASE
    WHEN is_half_day = TRUE AND half_day_period = 'morning' THEN 'first_half'
    WHEN is_half_day = TRUE AND half_day_period = 'afternoon' THEN 'second_half'
    ELSE 'full_day'
  END
WHERE half_day_type IS NULL OR half_day_type = 'full_day';

-- 5. Add comp_off balance to leave_balances (leave_type = 'comp_off')
-- Ensure comp_off is a valid leave type by inserting default rows for existing users
INSERT INTO leave_balances (user_id, leave_type, fiscal_year, total_days, used_days, carry_forward_days)
SELECT
  id,
  'comp_off',
  CASE WHEN EXTRACT(MONTH FROM NOW()) >= 4 THEN EXTRACT(YEAR FROM NOW())::INT ELSE EXTRACT(YEAR FROM NOW())::INT - 1 END,
  0,
  0,
  0
FROM user_profiles
WHERE is_active = TRUE
ON CONFLICT (user_id, leave_type, fiscal_year) DO NOTHING;

-- 6. RLS for overtime_requests
ALTER TABLE overtime_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "overtime_requests_select" ON overtime_requests;
CREATE POLICY "overtime_requests_select" ON overtime_requests
  FOR SELECT USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid()
      AND role IN ('manager','director','executive')
    )
  );

DROP POLICY IF EXISTS "overtime_requests_insert" ON overtime_requests;
CREATE POLICY "overtime_requests_insert" ON overtime_requests
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "overtime_requests_update" ON overtime_requests;
CREATE POLICY "overtime_requests_update" ON overtime_requests
  FOR UPDATE USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid()
      AND role IN ('manager','director','executive')
    )
  );

-- 7. RLS for comp_off_requests
ALTER TABLE comp_off_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "comp_off_requests_select" ON comp_off_requests;
CREATE POLICY "comp_off_requests_select" ON comp_off_requests
  FOR SELECT USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid()
      AND role IN ('manager','director','executive')
    )
  );

DROP POLICY IF EXISTS "comp_off_requests_insert" ON comp_off_requests;
CREATE POLICY "comp_off_requests_insert" ON comp_off_requests
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "comp_off_requests_update" ON comp_off_requests;
CREATE POLICY "comp_off_requests_update" ON comp_off_requests
  FOR UPDATE USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid()
      AND role IN ('manager','director','executive')
    )
  );

-- 8. Add end_of_day_time to director_settings if not present
INSERT INTO director_settings (setting_key, setting_value)
VALUES ('auto_checkout_time', '"17:30"')
ON CONFLICT (setting_key) DO NOTHING;

-- 9. Add fortnightly/quarterly/yearly/custom to recurring_tasks frequency
ALTER TABLE recurring_tasks
  ADD COLUMN IF NOT EXISTS custom_interval_days INT,
  ADD COLUMN IF NOT EXISTS weekday_only BOOLEAN NOT NULL DEFAULT FALSE;

-- Widen frequency column to accept new values
DO $$
BEGIN
  -- Drop old check constraint if it exists
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'recurring_tasks'
    AND constraint_name = 'recurring_tasks_frequency_check'
  ) THEN
    ALTER TABLE recurring_tasks DROP CONSTRAINT recurring_tasks_frequency_check;
  END IF;
END $$;

ALTER TABLE recurring_tasks
  ADD CONSTRAINT recurring_tasks_frequency_check
  CHECK (frequency IN ('daily','weekday','weekly','fortnightly','monthly','quarterly','yearly','custom'));
