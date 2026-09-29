-- Fix: Allow PIN-session (anon) users to submit and view attendance corrections
-- PIN-session users are not Supabase-authenticated (auth.uid() = null)
-- so we need anon-role policies for attendance_corrections and attendance_records

-- ============================================================
-- attendance_corrections: allow anon full access (PIN-session employees)
-- ============================================================
DROP POLICY IF EXISTS "attendance_corrections_anon_select" ON public.attendance_corrections;
CREATE POLICY "attendance_corrections_anon_select" ON public.attendance_corrections
FOR SELECT TO anon
  USING (true);

DROP POLICY IF EXISTS "attendance_corrections_anon_insert" ON public.attendance_corrections;
CREATE POLICY "attendance_corrections_anon_insert" ON public.attendance_corrections
FOR INSERT TO anon
  WITH CHECK (true);

DROP POLICY IF EXISTS "attendance_corrections_anon_update" ON public.attendance_corrections;
CREATE POLICY "attendance_corrections_anon_update" ON public.attendance_corrections
FOR UPDATE TO anon
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- attendance_records: allow anon read + write (PIN-session employees)
-- ============================================================
DROP POLICY IF EXISTS "attendance_records_anon_select" ON public.attendance_records;
CREATE POLICY "attendance_records_anon_select" ON public.attendance_records
FOR SELECT TO anon
  USING (true);

DROP POLICY IF EXISTS "attendance_records_anon_insert" ON public.attendance_records;
CREATE POLICY "attendance_records_anon_insert" ON public.attendance_records
FOR INSERT TO anon
  WITH CHECK (true);

DROP POLICY IF EXISTS "attendance_records_anon_update" ON public.attendance_records;
CREATE POLICY "attendance_records_anon_update" ON public.attendance_records
FOR UPDATE TO anon
  USING (true)
  WITH CHECK (true);
