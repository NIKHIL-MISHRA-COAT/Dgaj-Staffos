-- Attendance Records & Corrections Migration
-- Timestamp: 20260416140000

-- 1. Attendance status type
DROP TYPE IF EXISTS public.attendance_status CASCADE;
CREATE TYPE public.attendance_status AS ENUM ('present', 'absent', 'late', 'half_day', 'work_from_home', 'holiday', 'weekend');

DROP TYPE IF EXISTS public.correction_status CASCADE;
CREATE TYPE public.correction_status AS ENUM ('pending', 'approved', 'rejected');

-- 2. Attendance Records Table
CREATE TABLE IF NOT EXISTS public.attendance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  work_date DATE NOT NULL,
  clock_in TIMESTAMPTZ,
  clock_out TIMESTAMPTZ,
  status public.attendance_status DEFAULT 'present'::public.attendance_status,
  total_hours NUMERIC(5,2) DEFAULT 0,
  overtime_hours NUMERIC(5,2) DEFAULT 0,
  notes TEXT DEFAULT '',
  is_manual_entry BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 3. Attendance Corrections Table
CREATE TABLE IF NOT EXISTS public.attendance_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_record_id UUID REFERENCES public.attendance_records(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  work_date DATE NOT NULL,
  requested_clock_in TIMESTAMPTZ,
  requested_clock_out TIMESTAMPTZ,
  reason TEXT NOT NULL DEFAULT '',
  status public.correction_status DEFAULT 'pending'::public.correction_status,
  reviewed_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_attendance_records_user_id ON public.attendance_records(user_id);
CREATE INDEX IF NOT EXISTS idx_attendance_records_work_date ON public.attendance_records(work_date);
CREATE INDEX IF NOT EXISTS idx_attendance_records_user_date ON public.attendance_records(user_id, work_date);
CREATE INDEX IF NOT EXISTS idx_attendance_corrections_user_id ON public.attendance_corrections(user_id);
CREATE INDEX IF NOT EXISTS idx_attendance_corrections_status ON public.attendance_corrections(status);

-- 5. Unique constraint: one record per user per day
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_records_unique_user_date
  ON public.attendance_records(user_id, work_date);

-- 6. Helper function for manager/director check
CREATE OR REPLACE FUNCTION public.is_manager_or_director()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND role IN ('manager', 'director', 'executive')
  )
$$;

-- 7. Enable RLS
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_corrections ENABLE ROW LEVEL SECURITY;

-- 8. RLS Policies — attendance_records
DROP POLICY IF EXISTS "employees_view_own_attendance" ON public.attendance_records;
CREATE POLICY "employees_view_own_attendance"
  ON public.attendance_records FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_manager_or_director());

DROP POLICY IF EXISTS "employees_insert_own_attendance" ON public.attendance_records;
CREATE POLICY "employees_insert_own_attendance"
  ON public.attendance_records FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid() OR public.is_manager_or_director());

DROP POLICY IF EXISTS "employees_update_own_attendance" ON public.attendance_records;
CREATE POLICY "employees_update_own_attendance"
  ON public.attendance_records FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid() OR public.is_manager_or_director())
  WITH CHECK (user_id = auth.uid() OR public.is_manager_or_director());

-- 9. RLS Policies — attendance_corrections
DROP POLICY IF EXISTS "employees_manage_own_corrections" ON public.attendance_corrections;
CREATE POLICY "employees_manage_own_corrections"
  ON public.attendance_corrections FOR ALL
  TO authenticated
  USING (user_id = auth.uid() OR public.is_manager_or_director())
  WITH CHECK (user_id = auth.uid() OR public.is_manager_or_director());

-- 10. Updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_attendance_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS attendance_records_updated_at ON public.attendance_records;
CREATE TRIGGER attendance_records_updated_at
  BEFORE UPDATE ON public.attendance_records
  FOR EACH ROW EXECUTE FUNCTION public.update_attendance_updated_at();

DROP TRIGGER IF EXISTS attendance_corrections_updated_at ON public.attendance_corrections;
CREATE TRIGGER attendance_corrections_updated_at
  BEFORE UPDATE ON public.attendance_corrections
  FOR EACH ROW EXECUTE FUNCTION public.update_attendance_updated_at();
